#pragma once
#include <cstdint>
#include <string>
#include <vector>
namespace owfs { class UniqueFd { public: explicit UniqueFd(int value = -1) : value_(value) {} ~UniqueFd(); UniqueFd(const UniqueFd&) = delete; UniqueFd& operator=(const UniqueFd&) = delete; UniqueFd(UniqueFd&& other) noexcept; UniqueFd& operator=(UniqueFd&& other) noexcept; explicit operator bool() const { return value_ >= 0; } int get() const { return value_; } int release(); private: int value_; }; bool WriteAll(int fd, const std::vector<std::uint8_t>& bytes); bool MatchesRegularFile(int fd, const std::vector<std::uint8_t>& bytes); std::string JoinRelative(const std::vector<std::string>& segments, const std::string& leaf = {}); std::string PosixAuthorityId(int fd); }
