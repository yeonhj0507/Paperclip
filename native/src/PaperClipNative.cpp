// ---------------------------------------------------------------------
// Copyright ...
// SPDX-License-Identifier: BSD-3-Clause
// ---------------------------------------------------------------------
#include <string>
#include <mutex>
#include <filesystem>
#include <fstream>
#include <vector>
#include <iostream>
#include <cstring>   // memcpy
#include <cstdlib>   // malloc, free

#include "GenieCommon.h"
#include "GenieDialog.h"

#include "PaperClipNative.h"
#include "PromptHandler.hpp"

#ifdef _WIN32
#include <Windows.h>
#endif

namespace fs = std::filesystem;

// ─────────────────────────── Shared state ────────────────────────────
static std::mutex                 g_mu;
static bool                       g_inited = false;
static std::string                g_base_dir;          // where genie_bundle/ resides
static std::string                g_config_path;       // path to genie_config.json
static GenieDialogConfig_Handle_t g_cfg = nullptr;
static GenieDialog_Handle_t       g_dlg = nullptr;

struct CwdGuard {
    fs::path old;
    CwdGuard(const fs::path& to) : old(fs::current_path()) { fs::current_path(to); }
    ~CwdGuard() { std::error_code ec; fs::current_path(old, ec); }
};

// ───────────────────────────── Helpers ───────────────────────────────
static std::string utf8_from_w(const wchar_t* w) {
    if (!w) return {};
    int len = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    std::string s(len ? len - 1 : 0, '\0');
    if (len > 1) WideCharToMultiByte(CP_UTF8, 0, w, -1, s.data(), len, nullptr, nullptr);
    return s;
}

static fs::path dll_dir() {
#ifdef _WIN32
    HMODULE hMod = nullptr;
    if (!GetModuleHandleExW(
        GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        reinterpret_cast<LPCWSTR>(&dll_dir), &hMod)) {
        return fs::current_path();
    }
    wchar_t buf[MAX_PATH]{ 0 };
    DWORD n = GetModuleFileNameW(hMod, buf, MAX_PATH);
    return fs::path(buf, buf + (n ? n : 0)).parent_path();
#else
    return fs::current_path();
#endif
}

static std::string slurp(const fs::path& p) {
    std::ifstream ifs(p, std::ios::binary);
    if (!ifs) throw std::runtime_error("Cannot open: " + p.string());
    std::string s((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
    return s;
}

// ---------- JSON-safe helpers ----------
static std::string json_escape(const std::string& s) {
    std::string out; out.reserve(s.size() + 16);
    for (unsigned char c : s) {
        switch (c) {
        case '\"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\b': out += "\\b";  break;
        case '\f': out += "\\f";  break;
        case '\n': out += "\\n";  break;
        case '\r': out += "\\r";  break;
        case '\t': out += "\\t";  break;
        default:
            if (c < 0x20) {
                char buf[7]; std::snprintf(buf, sizeof(buf), "\\u%04X", (unsigned)c);
                out += buf;
            }
            else {
                out.push_back((char)c);
            }
        }
    }
    return out;
}

static char* heap_dup(const std::string& s) {
    char* c = (char*)std::malloc(s.size() + 1);
    if (!c) return nullptr;
    std::memcpy(c, s.data(), s.size());
    c[s.size()] = '\0';
    return c;
}

static std::string make_error_json(const std::string& stage,
    const std::string& message,
    const std::string& base_dir,
    const std::string& config_path) {
    // ASCII-only JSON
    std::string j = "{";
    j += "\"error\":\"" + json_escape(message) + "\",";
    j += "\"stage\":\"" + json_escape(stage) + "\",";
    j += "\"context\":{";
    j += "\"base_dir\":\"" + json_escape(base_dir) + "\",";
    j += "\"config_path\":\"" + json_escape(config_path) + "\"";
    j += "}";
    j += "}";
    return j;
}

// ---------- init ----------
static void ensure_init_locked() {
    if (g_inited) return;

    // Auto-discover defaults if not set
    if (g_base_dir.empty())    g_base_dir = dll_dir().string();
    if (g_config_path.empty()) g_config_path = (fs::path(g_base_dir) / "genie_config.json").string();

    // Validate presence
    fs::path base(g_base_dir);
    fs::path bundle = base / "genie_bundle";
    if (!fs::exists(base) || !fs::is_directory(base)) {
        throw std::runtime_error("Base dir not found: " + base.string());
    }
    if (!fs::exists(bundle) || !fs::is_directory(bundle)) {
        throw std::runtime_error("genie_bundle not found under base dir: " + bundle.string());
    }
    if (!fs::exists(g_config_path) || !fs::is_regular_file(g_config_path)) {
        throw std::runtime_error("genie_config.json not found: " + g_config_path);
    }

    // Load config JSON before chdir
    const std::string cfg_json = slurp(g_config_path);

    // Genie init (most configs reference files relative to base_dir)
    CwdGuard guard(base);

    if (GENIE_STATUS_SUCCESS != GenieDialogConfig_createFromJson(cfg_json.c_str(), &g_cfg)) {
        throw std::runtime_error("GenieDialogConfig_createFromJson failed");
    }
    if (GENIE_STATUS_SUCCESS != GenieDialog_create(g_cfg, &g_dlg)) {
        GenieDialogConfig_free(g_cfg); g_cfg = nullptr;
        throw std::runtime_error("GenieDialog_create failed");
    }

    g_inited = true;
}

static void ensure_init() {
    std::lock_guard<std::mutex> lk(g_mu);
    ensure_init_locked();
}

static void genie_cleanup_locked() {
    if (g_dlg) { GenieDialog_free(g_dlg);  g_dlg = nullptr; }
    if (g_cfg) { GenieDialogConfig_free(g_cfg); g_cfg = nullptr; }
    g_inited = false;
}

static void append_and_print(const char* chunk,
    const GenieDialog_SentenceCode_t code,
    std::string& acc)
{
    if (chunk) acc.append(chunk);
    (void)code; // no console printing here
}

// ─────────────────────────── Exported API ────────────────────────────
extern "C" PR_API const char* generate_polite_rewrite(const char* input_utf8) {
    // track stage for better diagnostics
    const char* stage = "pre-init";
    try {
        stage = "init";
        ensure_init();

        stage = "prompt";
        std::string in = (input_utf8 ? input_utf8 : "");
        AppUtils::PromptHandler ph;
        std::string tagged = ph.MakePoliteRewritePrompt(in);

        std::string out;

        // Some configs use relative paths; run under base_dir as CWD
        stage = "cwd-guard";
        CwdGuard guard{ fs::path(g_base_dir) };

        stage = "query";
        auto cb = [](const char* resp,
            const GenieDialog_SentenceCode_t code,
            const void* user_data)
            {
                auto* acc = static_cast<std::string*>(const_cast<void*>(user_data));
                append_and_print(resp, code, *acc);
            };

        const auto want = GenieDialog_SentenceCode_t::GENIE_DIALOG_SENTENCE_COMPLETE;

        if (GENIE_STATUS_SUCCESS != GenieDialog_query(g_dlg, tagged.c_str(), want, cb, &out)) {
            // Make this a structured error instead of throwing a generic one
            std::string j = make_error_json("query-failed",
                "GenieDialog_query failed",
                g_base_dir, g_config_path);
            return heap_dup(j);
        }

        // If model produced empty output, return a structured error too
        if (out.empty()) {
            std::string j = make_error_json("empty-output",
                "Model produced empty response",
                g_base_dir, g_config_path);
            return heap_dup(j);
        }

        // Success — return raw model text (host will normalize/wrap)
        return heap_dup(out);
    }
    catch (const std::exception& e) {
        std::string j = make_error_json(stage, e.what(), g_base_dir, g_config_path);
        return heap_dup(j);
    }
    catch (...) {
        std::string j = make_error_json(stage, "unknown exception", g_base_dir, g_config_path);
        return heap_dup(j);
    }
}

extern "C" PR_API void polite_rewrite_free(const char* str) {
    if (str) std::free((void*)str);
}

extern "C" PR_API int polite_rewrite_set_base_dir(const char* base_dir_utf8) {
    try {
        std::lock_guard<std::mutex> lk(g_mu);
        if (g_inited) { genie_cleanup_locked(); }
        g_base_dir = (base_dir_utf8 ? base_dir_utf8 : "");
        return 0;
    }
    catch (...) { return -1; }
}

extern "C" PR_API int polite_rewrite_set_config_path(const char* config_path_utf8) {
    try {
        std::lock_guard<std::mutex> lk(g_mu);
        if (g_inited) { genie_cleanup_locked(); }
        g_config_path = (config_path_utf8 ? config_path_utf8 : "");
        return 0;
    }
    catch (...) { return -1; }
}

extern "C" PR_API const char* polite_rewrite_warmup() {
    const char* stage = "init";
    try {
        ensure_init(); // 이미 mutex로 보호 + 다중 호출 안전
        std::string ok = "{\"ok\":true,\"stage\":\"warmup\"}";
        return heap_dup(ok);
    }
    catch (const std::exception& e) {
        std::string j = make_error_json(stage, e.what(), g_base_dir, g_config_path);
        return heap_dup(j);
    }
    catch (...) {
        std::string j = make_error_json(stage, "unknown exception", g_base_dir, g_config_path);
        return heap_dup(j);
    }
}
