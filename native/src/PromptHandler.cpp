#include "PromptHandler.hpp"
#include <algorithm>
#include <cctype>
#include <string>

namespace {
    inline std::string trim(std::string s) {
        auto ns = [](unsigned char c) { return !std::isspace(c); };
        s.erase(s.begin(), std::find_if(s.begin(), s.end(), ns));
        s.erase(std::find_if(s.rbegin(), s.rend(), ns).base(), s.end());
        return s;
    }
}

namespace AppUtils {

    // NOTE: 이 구현은 호출마다 완전한 system/user 블록을 생성합니다.
    // (DLL 내 세션 공유 여부와 무관하게 프롬프트 일관성 보장)
    std::string PromptHandler::MakePoliteRewritePrompt(const std::string& user_prompt_utf8) {
        const std::string target = trim(user_prompt_utf8);

        // ── System 규칙: 역할/출력 규격 고정 ───────────────────────────────
        static const char* kSystem =
            "ROLE: Email Tone Polishing Assistant.\n"
            "\n"
            "OBJECTIVE:\n"
            "Given a \"Target\" sentence and the full preceding context labeled \"Context\", "
            "return three polite and professional rewrites of the Target that preserve its original meaning "
            "and intent, while remaining coherent with the entire Context.\n"
            "\n"
            "LANGUAGE:\n"
            "- If the Target is Korean, respond in Korean. Always use formal business register "
            "with honorific endings (–습니다, –시기 바랍니다, –해 주시면 감사하겠습니다). "
            "Do not use informal speech or pronouns like '너/당신'.\n"
            "- Else if the Target is Japanese, respond in Japanese. Always use 丁寧語 (です/ます調), "
            "avoiding casual forms.\n"
            "- Else if the Target is English, respond in English, using a professional business tone.\n"
            "- Otherwise, respond in the Target's language.\n"
            "\n"
            "OUTPUT:\n"
            "Return exactly one JSON array of four UTF-8 strings:\n"
            "[\n"
            "  \"polite\" or \"impolite\",   // classify the Target's tone\n"
            "  \"alternative1\",             // polite, professional rewrite\n"
            "  \"alternative2\",             // polite, professional rewrite\n"
            "  \"alternative3\"              // polite, professional rewrite\n"
            "]\n"
            "No extra text, no trailing commentary.\n"
            "\n"
            "TONE CLASSIFICATION:\n"
            "- Use \"impolite\" if the Target contains informal speech, slang, blunt commands without courtesy, "
            "sarcasm, offensive language, or unprofessional tone.\n"
            "- Otherwise, use \"polite\".\n"
            "\n"
            "CONDUCT:\n"
            "- Always consider the full Context when generating rewrites, ensuring logical and stylistic consistency.\n"
            "- Preserve the meaning, facts, numbers, entities, and placeholders exactly.\n"
            "- Do NOT change or invent new deadlines, conditions, or commitments.\n"
            "- Do NOT repeat the Target in the output.\n"
            "- Do NOT include explanations, advice, or extra commentary.\n"
            "- Output must always contain exactly four strings.\n";



        // ── ChatML 구성 ───────────────────────────────────────────────────
        // <|im_start|>system ... <|im_end|>
        // <|im_start|>user   Target: ... <|im_end|>
        // <|im_start|>assistant
        std::string out;
        out.reserve(target.size() + 1024);

        out += "<|im_start|>system\n";
        out += kSystem;
        out += "\n<|im_end|>\n";

        out += "<|im_start|>user\n";
        out += "Target: ";
        out += target.empty() ? "Hello." : target;
        out += "\n<|im_end|>\n";

        out += "<|im_start|>assistant\n";

        return out;
    }

} // namespace AppUtils
