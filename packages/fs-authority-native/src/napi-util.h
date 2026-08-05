#pragma once
#include <node_api.h>
#include <cstdint>
#include <string>
#include <vector>
#include "authority.h"
namespace owfs { extern const napi_type_tag kAuthorityTypeTag; void Check(napi_env env, napi_status status, const char* operation); void TagObject(napi_env env, napi_value value, const napi_type_tag& tag); void* TaggedExternal(napi_env env, napi_value value, const napi_type_tag& tag); std::string JsString(napi_env env, napi_value value); std::vector<std::uint8_t> JsBytes(napi_env env, napi_value value); std::vector<std::string> JsStringArray(napi_env env, napi_value value); std::string JsOptionalString(napi_env env, napi_value object, const char* name); napi_value JsStringValue(napi_env env, const std::string& value); napi_value JsPublishResult(napi_env env, const PublishResult& result); void ThrowJs(napi_env env, const std::string& code, const std::string& message); }
