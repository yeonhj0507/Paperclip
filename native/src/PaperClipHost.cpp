// native/src/paperClipHost.cpp — Chrome Native Messaging host + PaperClipNative.dll
//
// DLL exports expected (1-arg versions):
//   const char* generate_polite_rewrite(const char* input_utf8);
//   void        polite_rewrite_free(const char* p);
//   int         polite_rewrite_set_base_dir(const char* dir);      // optional
//   int         polite_rewrite_set_config_path(const char* path);  // optional
//
// Request : {"type":"analyze","focus":"...","context":"...","body":"..."}
// Response: {"suggestions":[ "polite/impolite", "Suggestion1", "Suggestion2", ... ]}

#include <iostream>
#include <string>
#include <cstdint>
#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <filesystem>

namespace fs = std::filesystem;

#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#include <windows.h>
#else
#include <locale>
#include <codecvt>
#endif

// ===================================================================
// Native Messaging I/O
// ===================================================================
#ifdef _WIN32
static void ensure_binary_mode_once() {
    static bool once = false;
    if (!once) {
        _setmode(_fileno(stdin), _O_BINARY);
        _setmode(_fileno(stdout), _O_BINARY);
        once = true;
    }
}
struct StdoutSilencer {
    int    saved_fd = -1;
    HANDLE saved_std_handle = nullptr;
    HANDLE hNull = nullptr;
    StdoutSilencer() {
        saved_std_handle = GetStdHandle(STD_OUTPUT_HANDLE);
        hNull = CreateFileW(L"NUL", GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
            nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (hNull && hNull != INVALID_HANDLE_VALUE) {
            SetStdHandle(STD_OUTPUT_HANDLE, hNull);
        }
        fflush(stdout);
        saved_fd = _dup(_fileno(stdout));
        FILE* nul = nullptr;
        freopen_s(&nul, "NUL", "w", stdout);
    }
    ~StdoutSilencer() {
        fflush(stdout);
        if (saved_fd != -1) {
            _dup2(saved_fd, _fileno(stdout));
            _close(saved_fd);
            saved_fd = -1;
        }
        if (saved_std_handle) {
            SetStdHandle(STD_OUTPUT_HANDLE, saved_std_handle);
            saved_std_handle = nullptr;
        }
        if (hNull && hNull != INVALID_HANDLE_VALUE) {
            CloseHandle(hNull);
            hNull = nullptr;
        }
    }
};
#else
static void ensure_binary_mode_once() {}
#endif

static void write_msg(const std::string& s) {
    ensure_binary_mode_once();
    const uint32_t len = static_cast<uint32_t>(s.size());
    std::cout.write(reinterpret_cast<const char*>(&len), 4);
    std::cout.write(s.data(), s.size());
    std::cout.flush();
}

static bool read_msg(std::string& out) {
    ensure_binary_mode_once();
    uint32_t len = 0;
    if (!std::cin.read(reinterpret_cast<char*>(&len), 4)) return false;
    if (len == 0) return false;
    std::string buf(len, '\0');
    if (!std::cin.read(&buf[0], len)) return false;
    out.swap(buf);
    return true;
}

// ===================================================================
// Tiny JSON helpers
// ===================================================================
static std::string json_escape(const std::string& s) {
    std::string out; out.reserve(s.size() + 8);
    for (char c : s) {
        switch (c) {
        case '\"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n";  break;
        case '\r': out += "\\r";  break;
        case '\t': out += "\\t";  break;
        default:   out.push_back(c); break;
        }
    }
    return out;
}

static std::string get_json_string(const std::string& src, const std::string& key) {
    const std::string pattern = "\"" + key + "\"";
    size_t p = src.find(pattern);
    if (p == std::string::npos) return "";
    p = src.find(':', p + pattern.size());
    if (p == std::string::npos) return "";
    while (p < src.size() && (src[p] == ':' || (unsigned char)src[p] <= ' ')) ++p;
    if (p >= src.size() || src[p] != '"') return "";
    ++p;
    std::string val;
    while (p < src.size()) {
        char c = src[p++];
        if (c == '\\') {
            if (p < src.size()) {
                char e = src[p++];
                if (e == 'n')      val.push_back('\n');
                else if (e == 'r') val.push_back('\r');
                else if (e == 't') val.push_back('\t');
                else               val.push_back(e); // includes '"' and '\'
            }
        }
        else if (c == '"') {
            break;
        }
        else {
            val.push_back(c);
        }
    }
    return val;
}

// Extract literal array after "suggestions": [...]
static std::string extract_suggestions_array(const std::string& src) {
    const std::string key = "\"suggestions\"";
    size_t k = src.find(key);
    if (k == std::string::npos) return "";
    size_t colon = src.find(':', k + key.size());
    if (colon == std::string::npos) return "";
    size_t p = colon + 1;
    while (p < src.size() && (unsigned char)src[p] <= ' ') ++p;
    if (p >= src.size() || src[p] != '[') return "";
    int depth = 0; size_t start = p;
    for (size_t i = p; i < src.size(); ++i) {
        char c = src[i];
        if (c == '[') depth++;
        else if (c == ']') {
            depth--;
            if (depth == 0) return src.substr(start, i - start + 1);
        }
    }
    return "";
}

// Normalize DLL JSON into {"suggestions":[...]}
static std::string normalize_to_suggestions(const std::string& dll_json) {
    size_t a = 0, b = dll_json.size();
    while (a < b && (unsigned char)dll_json[a] <= ' ') ++a;
    while (b > a && (unsigned char)dll_json[b - 1] <= ' ') --b;
    if (a >= b) return "{\"suggestions\":[\"Error\",\"Empty response\"]}";
    const char first = dll_json[a];
    if (first == '[') {
        std::string out = "{\"suggestions\":";
        out.append(dll_json, a, b - a);
        out += "}";
        return out;
    }
    if (first == '{') {
        std::string arr = extract_suggestions_array(dll_json.substr(a, b - a));
        if (!arr.empty()) {
            std::string out = "{\"suggestions\":";
            out += arr;
            out += "}";
            return out;
        }
        return std::string("{\"suggestions\":[\"") + json_escape(dll_json.substr(a, b - a)) + "\"]}";
    }
    return std::string("{\"suggestions\":[\"") + json_escape(dll_json.substr(a, b - a)) + "\"]}";
}

// ===================================================================
// Windows DLL glue
// ===================================================================
#ifdef _WIN32
typedef const char* (__cdecl* fn_generate_t)(const char*);
typedef void(__cdecl* fn_free_t)(const char*);
typedef int(__cdecl* fn_set_path_t)(const char*);

static HMODULE        g_lib = nullptr;
static fn_generate_t  g_generate = nullptr;
static fn_free_t      g_free = nullptr;
static fn_set_path_t  g_set_base = nullptr;
static fn_set_path_t  g_set_config = nullptr;

static std::wstring utf8_to_w(const std::string& s) {
    if (s.empty()) return L"";
    const int need = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    std::wstring w((need > 0) ? (need - 1) : 0, L'\0');
    if (need > 1) MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &w[0], need);
    return w;
}
static std::string w_to_utf8(const std::wstring& w) {
    if (w.empty()) return std::string();
    const int need = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string s((need > 0) ? (need - 1) : 0, '\0');
    if (need > 1) WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, &s[0], need, nullptr, nullptr);
    return s;
}
static std::string exe_dir_utf8() {
    wchar_t buf[MAX_PATH]{};
    DWORD n = GetModuleFileNameW(nullptr, buf, MAX_PATH);
    if (!n || n >= MAX_PATH) return std::string();
    std::wstring path(buf, n);
    size_t p1 = path.find_last_of(L'\\');
    size_t p2 = path.find_last_of(L'/');
    size_t pos = (p1 == std::wstring::npos) ? p2 : (p2 == std::wstring::npos ? p1 : (p1 > p2 ? p1 : p2));
    std::wstring dir = (pos == std::wstring::npos) ? L"." : path.substr(0, pos);
    return w_to_utf8(dir);
}
static std::string dll_dir_utf8(HMODULE hmod) {
    wchar_t buf[MAX_PATH]{};
    DWORD n = GetModuleFileNameW(hmod, buf, MAX_PATH);
    if (!n || n >= MAX_PATH) return std::string();
    std::wstring path(buf, n);
    size_t p1 = path.find_last_of(L'\\');
    size_t p2 = path.find_last_of(L'/');
    size_t pos = (p1 == std::wstring::npos) ? p2 : (p2 == std::wstring::npos ? p1 : (p1 > p2 ? p1 : p2));
    std::wstring dir = (pos == std::wstring::npos) ? L"." : path.substr(0, pos);
    return w_to_utf8(dir);
}

// Send diagnostics via NM frame (visible in BG logs)
static void write_diag(std::string path, size_t in_len, size_t out_len, std::string note) {
    auto esc = [](const std::string& s) {
        std::string o; o.reserve(s.size() + 8);
        for (char c : s) {
            switch (c) {
            case '\"': o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n";  break;
            case '\r': o += "\\r";  break;
            case '\t': o += "\\t";  break;
            default:   o.push_back(c); break;
            }
        }
        return o;
        };
    std::string msg;
    msg += "{\"type\":\"diag\",\"path\":\"";
    msg += esc(path);
    msg += "\",\"in_len\":";
    msg += std::to_string(static_cast<unsigned long long>(in_len));
    msg += ",\"out_len\":";
    msg += std::to_string(static_cast<unsigned long long>(out_len));
    msg += ",\"note\":\"";
    msg += esc(note);
    msg += "\"}";
    write_msg(msg);
}


#ifdef _WIN32
static void log_last_err(const char* where) {
    DWORD e = GetLastError();
    LPWSTR msg = nullptr;
    FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr, e, 0, (LPWSTR)&msg, 0, nullptr);
    std::string s = w_to_utf8(msg ? msg : L"");
    if (msg) LocalFree(msg);
    write_diag("dll", 0, 0, std::string(where) + " GLE=" + std::to_string(e) + " " + s);
}
#endif


static void try_load_lib() {
    if (g_lib) return;

    // (1) env var
    char dll_env[1024] = { 0 }; size_t n = 0;
    if (getenv_s(&n, dll_env, "PC_SUGGESTION_DLL") == 0 && n > 0) {
        g_lib = ::LoadLibraryW(utf8_to_w(dll_env).c_str());
        write_diag("dll", 0, 0, std::string("LoadLibrary env ") + (g_lib ? "OK: " : "FAIL: ") + dll_env);
        if (!g_lib) log_last_err("LoadLibrary env");   //  add
    }

    // (2) exe dir fallback
    if (!g_lib) {
        std::string path = exe_dir_utf8() + "\\PaperClipNative.dll";
        g_lib = ::LoadLibraryW(utf8_to_w(path).c_str());
        write_diag("dll", 0, 0, std::string("LoadLibrary exe ") + (g_lib ? "OK: " : "FAIL: ") + path);
        if (!g_lib) {                                  //  add
            log_last_err("LoadLibrary exe");
            return; // remain
        }
    }
    if (!g_lib) return;

    g_generate = reinterpret_cast<fn_generate_t>(::GetProcAddress(g_lib, "generate_polite_rewrite"));
    g_free = reinterpret_cast<fn_free_t>(::GetProcAddress(g_lib, "polite_rewrite_free"));
    g_set_base = reinterpret_cast<fn_set_path_t>(::GetProcAddress(g_lib, "polite_rewrite_set_base_dir"));
    g_set_config = reinterpret_cast<fn_set_path_t>(::GetProcAddress(g_lib, "polite_rewrite_set_config_path"));

    if (!g_generate || !g_free) {
        write_diag("dll", 0, 0, "GetProcAddress missing exports");
        return;
    }

    // Inject base dir
    if (g_set_base) {
        char base_env[1024] = { 0 }; size_t m = 0;
        int  rc = -1;
        if (getenv_s(&m, base_env, "PC_MODEL_BASE_DIR") == 0 && m > 0) {
            rc = g_set_base(base_env);
            write_diag("dll", 0, 0, std::string("set_base (env) ") + (rc == 0 ? "OK " : "FAIL ") + base_env);
        }
        else {
            std::string d = dll_dir_utf8(g_lib);
            rc = g_set_base(d.c_str());
            write_diag("dll", 0, 0, std::string("set_base (dll) ") + (rc == 0 ? "OK " : "FAIL ") + d);
        }
    }

    // Config path
    if (g_set_config) {
        char cfg_env[1024] = { 0 }; size_t k = 0;
        bool set_cfg = false;
        if (getenv_s(&k, cfg_env, "PC_CONFIG_PATH") == 0 && k > 0) {
            int rc = g_set_config(cfg_env);
            write_diag("dll", 0, 0, std::string("set_config (env) ") + (rc == 0 ? "OK " : "FAIL ") + cfg_env);
            set_cfg = (rc == 0);
        }
        if (!set_cfg) {
            std::string d = dll_dir_utf8(g_lib);
            std::string cfg = d + "\\genie_config.json";
            if (fs::exists(fs::path(cfg))) {
                int rc = g_set_config(cfg.c_str());
                write_diag("dll", 0, 0, std::string("set_config (dll) ") + (rc == 0 ? "OK " : "FAIL ") + cfg);
            }
            else {
                write_diag("dll", 0, 0, "NO genie_config.json beside DLL");
            }
        }
    }

    //  warmup 완전 제거 (로그로 명시만)
    write_diag("dll", 0, 0, "warmup-skipped");

    // === extra probe after set_base / set_config ===
    std::string base = "";
    {
        char base_env[1024] = { 0 }; size_t m = 0;
        if (getenv_s(&m, base_env, "PC_MODEL_BASE_DIR") == 0 && m > 0) base = base_env;
    }
    if (base.empty() && g_lib) base = dll_dir_utf8(g_lib); // fallback, just in case

    std::string bundle = base + "\\genie_bundle";
    write_diag("probe", 0, 0, std::string("bundle_path=") + bundle +
        (fs::exists(bundle) ? " (exists)" : " (MISSING)"));

    if (!SetDllDirectoryW(utf8_to_w(bundle).c_str())) {
        log_last_err("SetDllDirectory(bundle)");
    }
    write_diag("probe", 0, 0, "SetDllDirectory(bundle) set");

    std::string cfg = "";
    {
        char cfg_env[1024] = { 0 }; size_t k = 0;
        if (getenv_s(&k, cfg_env, "PC_CONFIG_PATH") == 0 && k > 0) cfg = cfg_env;
    }
    if (cfg.empty() && g_lib) cfg = dll_dir_utf8(g_lib) + "\\genie_config.json";
    write_diag("probe", 0, 0, std::string("config_path=") + cfg +
        (fs::exists(cfg) ? " (exists)" : " (MISSING)"));

    // list first few files under bundle
    if (fs::exists(bundle)) {
        size_t cnt = 0;
        for (auto& e : fs::directory_iterator(bundle)) {
            if (++cnt <= 8) write_diag("probe", 0, 0, std::string("bundle_file: ") + e.path().filename().string());
        }
        write_diag("probe", 0, 0, std::string("bundle_count=") + std::to_string(cnt));
    }

    // Try LoadLibrary on Genie.dll explicitly from bundle (helpful on ARM64)
    std::wstring wGenie = utf8_to_w(bundle + "\\Genie.dll");
    HMODULE hGenie = ::LoadLibraryW(wGenie.c_str());
    if (!hGenie) {
        DWORD err = GetLastError();
        write_diag("probe", 0, 0, std::string("LoadLibrary Genie.dll FAILED, GLE=") + std::to_string(err));
        log_last_err("LoadLibrary Genie.dll"); // add
    }
    else {
        write_diag("probe", 0, 0, "LoadLibrary Genie.dll OK (probe)");
        ::FreeLibrary(hGenie);
    }

    // Add search dir so later dynamic loads can find deps under bundle
    SetDllDirectoryW(utf8_to_w(bundle).c_str());
    write_diag("probe", 0, 0, "SetDllDirectory(bundle) set");

}
#endif // _WIN32

// ===================================================================
// analyze
// ===================================================================
static std::string handle_analyze(const std::string& focus,
    const std::string& /*context*/,
    const std::string& body) {
#ifdef _WIN32
    try_load_lib();
    if (g_generate) {
        auto trim = [](const std::string& s) {
            size_t a = 0, b = s.size();
            while (a < b && (unsigned char)s[a] <= ' ') ++a;
            while (b > a && (unsigned char)s[b - 1] <= ' ') --b;
            return s.substr(a, b - a);
            };
        std::string target = trim(focus.empty() ? body : focus);
        if (target.empty()) target = "Hello.";

        write_diag("dll", target.size(), 0, "invoke-before");

        std::string dll_json;
        {
            StdoutSilencer mute; // DLL이 stdout 찍어도 NM 프레이밍 보호
            const char* p = g_generate(target.c_str());
            if (p) { dll_json.assign(p); if (g_free) g_free(p); }
        }

        write_diag("dll", target.size(), 0, dll_json.empty() ? "invoke-return-empty"
            : "invoke-return-nonnull");

        if (dll_json.empty()) {
            std::string s = "{\"suggestions\":["
                "\"Polite\","
                "\"Could you clarify this point?\","
                "\"I would appreciate your feedback when you have a moment.\""
                "]}";
            write_diag("dll", target.size(), s.size(), "empty->fallback");
            return s;
        }

        if (dll_json.size() > 900000) dll_json.resize(900000); // guard

        std::string out = normalize_to_suggestions(dll_json);
        write_diag("dll", target.size(), out.size(), "ok");
        return out;
    }
#endif
    // Fallback (no DLL loaded)
    std::string low = body;
    std::transform(low.begin(), low.end(), low.begin(),
        [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    const bool rude = (low.find("idiot") != std::string::npos) ||
        (low.find("stupid") != std::string::npos);

    if (rude) {
        return "{\"suggestions\":[\"Rude\",\"Please soften the expression.\",\"Consider acknowledging the recipient's view.\"]}";
    }
    return "{\"suggestions\":[\"Polite\",\"Adding a brief thanks at the end can help.\"]}";
}

// ===================================================================
// main
// ===================================================================
int main() {
#ifdef _WIN32
    try_load_lib();
    write_diag("host", 0, 0, g_lib ? "startup-load-ok" : "startup-load-fail");
#endif

    std::string raw;
    while (read_msg(raw)) {
        write_diag("host", raw.size(), 0,
            std::string("recv: ") + (raw.size() > 64 ? raw.substr(0, 64) + "..." : raw));
        const std::string type = get_json_string(raw, "type");
        if (type == "ping") {
#ifdef _WIN32
            try_load_lib();
#endif
            write_diag("host", 0, 0, "recv-ping");
            write_msg("{\"type\":\"pong\"}");
            write_diag("host", 0, 0, "sent-pong");
            continue;
        }
        if (type == "analyze") {
            const std::string focus = get_json_string(raw, "focus");
            const std::string context = get_json_string(raw, "context");
            const std::string body = get_json_string(raw, "body");
            (void)context;
            write_msg(handle_analyze(focus, context, body));
            continue;
        }
        write_msg("{\"error\":\"unknown type\"}");
    }
    return 0;
}
