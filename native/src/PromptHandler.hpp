#pragma once
#include <string>

namespace AppUtils {

class PromptHandler {
  bool m_is_first = true;
public:
  // 첫 호출에서만 system 역할 안내를 추가하고, 이후엔 user만 태그
  std::string MakePoliteRewritePrompt(const std::string& user_prompt_utf8);
};

} // namespace AppUtils
