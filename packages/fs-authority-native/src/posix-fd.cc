#include "posix-fd.h"
#include <algorithm>
#include <array>
#include <cerrno>
#include <cstring>
#include <iomanip>
#include <sstream>
#include <sys/stat.h>
#include <unistd.h>
namespace owfs { UniqueFd::~UniqueFd() { if (value_ >= 0) close(value_); } UniqueFd::UniqueFd(UniqueFd&& other) noexcept : value_(other.release()) {} UniqueFd& UniqueFd::operator=(UniqueFd&& other) noexcept { if (this != &other) { if (value_ >= 0) close(value_); value_ = other.release(); } return *this; } int UniqueFd::release() { const int value = value_; value_ = -1; return value; }
bool WriteAll(int fd, const std::vector<std::uint8_t>& bytes) { std::size_t offset = 0; while (offset < bytes.size()) { const auto written = write(fd, bytes.data() + offset, bytes.size() - offset); if (written > 0) offset += static_cast<std::size_t>(written); else if (written < 0 && errno == EINTR) continue; else return false; } return true; }
bool MatchesRegularFile(int fd, const std::vector<std::uint8_t>& bytes) { struct stat info {}; if (fstat(fd, &info) != 0 || !S_ISREG(info.st_mode) || info.st_nlink != 1 || info.st_size != static_cast<off_t>(bytes.size())) return false; std::array<std::uint8_t, 8192> buffer{}; std::size_t offset = 0; while (offset < bytes.size()) { const std::size_t requested = std::min(buffer.size(), bytes.size() - offset); const auto count = pread(fd, buffer.data(), requested, static_cast<off_t>(offset)); if (count > 0) { if (memcmp(buffer.data(), bytes.data() + offset, static_cast<std::size_t>(count)) != 0) return false; offset += static_cast<std::size_t>(count); } else if (count < 0 && errno == EINTR) continue; else return false; } return true; }
std::string JoinRelative(const std::vector<std::string>& segments, const std::string& leaf) { std::string result; for (const auto& segment : segments) { if (!result.empty()) result.push_back('/'); result.append(segment); } if (!leaf.empty()) { if (!result.empty()) result.push_back('/'); result.append(leaf); } return result; }
std::string PosixAuthorityId(int fd) { struct stat info {}; if (fstat(fd, &info) != 0 || !S_ISDIR(info.st_mode)) return {}; std::ostringstream value; value << "posix:v1:" << std::hex << static_cast<std::uint64_t>(info.st_dev) << ':' << static_cast<std::uint64_t>(info.st_ino); return value.str(); } }
