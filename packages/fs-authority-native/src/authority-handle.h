#pragma once
#include <node_api.h>
#include <memory>
#include "authority.h"
namespace owfs { napi_value CreateAuthorityHandle(napi_env env, std::unique_ptr<Authority> authority); Authority* AuthorityFromHandle(napi_env env, napi_value value); void ExportAuthorityClose(napi_env env, napi_value exports); }
