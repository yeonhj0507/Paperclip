// ---------------------------------------------------------------------
// Copyright ...
// SPDX-License-Identifier: BSD-3-Clause
// ---------------------------------------------------------------------
#pragma once
#include <stdint.h>

#ifdef _WIN32
  #define PR_API __declspec(dllexport)
#else
  #define PR_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

// 단일 호출 API:
// - input_utf8: 입력 문장(UTF-8)
// - 반환: 힙에 할당된 UTF-8 문자열 포인터. 사용 후 반드시 polite_rewrite_free()로 해제.
PR_API const char* generate_polite_rewrite(const char* input_utf8);

// 반환 문자열 해제 함수
PR_API void polite_rewrite_free(const char* str);

// (선택) 초기화가 먼저 필요한 경우를 위해 경로를 강제 지정하고 싶다면 아래 2개를 먼저 호출할 수 있습니다.
// 경로는 UTF-8, 존재해야 함.
// 지정하지 않으면 DLL 위치 기준으로 assets의 genie_config.json / genie_bundle을 자동 탐색합니다.
PR_API int polite_rewrite_set_base_dir(const char* base_dir_utf8);
PR_API int polite_rewrite_set_config_path(const char* config_path_utf8);


//웜업 함수
PR_API const char* polite_rewrite_warmup();

#ifdef __cplusplus
} // extern "C"
#endif
