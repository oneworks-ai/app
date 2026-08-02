#pragma once
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
namespace owfs {
struct AuthorityError final : std::runtime_error { AuthorityError(std::string error_code, std::string message) : std::runtime_error(std::move(message)), code(std::move(error_code)) {} std::string code; };
struct PublishRequest { std::string authority_id; std::vector<std::string> parent_segments; std::string basename; std::vector<std::uint8_t> bytes; std::string nonce; std::string fault; };
struct PublishResult { std::string state; std::string code; std::vector<std::string> warnings; bool committed = false; bool indeterminate = false; };
class Authority { public: virtual ~Authority() = default; virtual const std::string& id() const = 0; virtual const std::string& capability() const = 0; virtual PublishResult Publish(const PublishRequest& request) = 0; };
std::unique_ptr<Authority> OpenPlatformAuthority(const std::string& workspace_root, const std::string& control_root);
void ValidateRequest(const PublishRequest& request); void TestCheckpoint(const PublishRequest& request); void TestFinalPublishCheckpoint(const PublishRequest& request);
PublishResult Failure(const std::string& code); PublishResult Committed(); PublishResult Degraded(const std::string& warning); PublishResult Indeterminate(const std::string& warning);
}  // namespace owfs
