#include "darwin-tree-cleanup.h"

#include "posix-fd.h"

#include <cerrno>
#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace owfs {
namespace {
struct Link {
  int parent;
  const std::string& name;
  int descriptor;
  const Link* ancestor;
};

bool Current(const Link& link) {
  if (link.ancestor != nullptr && !Current(*link.ancestor)) return false;
  struct stat expected {};
  struct stat actual {};
  return fstat(link.descriptor, &expected) == 0 &&
    fstatat(link.parent, link.name.c_str(), &actual, AT_SYMLINK_NOFOLLOW) == 0 &&
    expected.st_dev == actual.st_dev && expected.st_ino == actual.st_ino;
}

bool RemoveContents(int directory, const Link& link) {
  const int duplicate = fcntl(directory, F_DUPFD_CLOEXEC, 0);
  if (duplicate < 0) return false;
  DIR* stream = fdopendir(duplicate);
  if (stream == nullptr) {
    close(duplicate);
    return false;
  }
  bool success = true;
  while (success) {
    errno = 0;
    dirent* entry = readdir(stream);
    if (entry == nullptr) {
      success = errno == 0;
      break;
    }
    const std::string child_name(entry->d_name);
    if (child_name == "." || child_name == "..") continue;
    struct stat info {};
    if (fstatat(directory, child_name.c_str(), &info, AT_SYMLINK_NOFOLLOW) != 0) {
      success = errno == ENOENT;
      continue;
    }
    if (!S_ISDIR(info.st_mode)) {
      success = Current(link) && (unlinkat(directory, child_name.c_str(), 0) == 0 || errno == ENOENT);
      continue;
    }
    UniqueFd child(openat(directory, child_name.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW_ANY));
    if (!child) {
      success = false;
      continue;
    }
    const Link child_link{directory, child_name, child.get(), &link};
    success = Current(child_link) && RemoveContents(child.get(), child_link) && Current(child_link) &&
      unlinkat(directory, child_name.c_str(), AT_REMOVEDIR) == 0;
  }
  closedir(stream);
  return success;
}
}  // namespace

bool RemoveVerifiedTreeContents(int parent, const std::string& name, int directory) {
  const Link root{parent, name, directory, nullptr};
  return Current(root) && RemoveContents(directory, root) && Current(root);
}
}  // namespace owfs
