#include "darwin-tree.h"
#include "darwin-tree-cleanup.h"
#include "posix-fd.h"
#include <cerrno>
#include <chrono>
#include <fcntl.h>
#include <string>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>
namespace owfs {
namespace {
int OpenComponent(int parent, const std::string& name, int flags) {
  return openat(parent, name.c_str(), flags | O_CLOEXEC | O_NOFOLLOW_ANY);
}
PublishResult Error(const char* operation, int error) {
  PublishResult result = Failure(
    error == EEXIST ? "managed_tree_exists" :
    error == ELOOP || error == ENOENT || error == ENOTDIR ? "managed_tree_changed" :
    "asset_filesystem_authority_unavailable");
  result.warnings.push_back(std::string("darwin:") + operation + ":errno=" + std::to_string(error));
  return result;
}
UniqueFd OpenParent(int root, const std::vector<std::string>& segments, PublishResult* failure) {
  UniqueFd current(fcntl(root, F_DUPFD_CLOEXEC, 0));
  if (!current) {
    *failure = Error("tree-root-dup", errno);
    return UniqueFd();
  }
  for (const auto& segment : segments) {
    UniqueFd next(OpenComponent(current.get(), segment, O_RDONLY | O_DIRECTORY));
    if (!next) {
      *failure = Error("tree-open-parent", errno);
      return UniqueFd();
    }
    current = std::move(next);
  }
  return current;
}
bool EntryMissing(int parent, const std::string& name) {
  struct stat info {};
  if (fstatat(parent, name.c_str(), &info, AT_SYMLINK_NOFOLLOW) == 0) return false;
  return errno == ENOENT;
}

UniqueFd OpenExpected(int parent, const std::string& name, const std::string& identity) {
  UniqueFd entry(OpenComponent(parent, name, O_RDONLY | O_DIRECTORY));
  if (!entry || PosixAuthorityId(entry.get()) != identity) return UniqueFd();
  return entry;
}

void Checkpoint(const TreeRequest& request, const std::string& fault) {
  if (request.fault == fault) std::this_thread::sleep_for(std::chrono::milliseconds(1200));
}

void CrashCheckpoint(const TreeRequest& request, const std::string& fault) {
  if (request.fault == fault) std::_Exit(86);
}

bool SyncParent(int parent, const TreeRequest& request) {
  if (request.fault == "tree-parent-sync" || request.fault == "tree-stage-rollback-sync-failure") {
    errno = EIO;
    return false;
  }
  return fsync(parent) == 0;
}

bool SameEntry(int parent, const std::string& name, int descriptor) {
  struct stat expected {};
  struct stat actual {};
  return fstat(descriptor, &expected) == 0 &&
    fstatat(parent, name.c_str(), &actual, AT_SYMLINK_NOFOLLOW) == 0 &&
    expected.st_dev == actual.st_dev && expected.st_ino == actual.st_ino;
}

PublishResult State(
  const std::string& state,
  const std::string& parent_identity,
  const std::string& identity) {
  PublishResult result = Committed();
  result.state = state;
  result.parent_identity = parent_identity;
  result.identity = identity;
  return result;
}
}  // namespace

PublishResult DarwinTree(int root, const TreeRequest& request) {
  PublishResult failure;
  UniqueFd parent(OpenParent(root, request.parent_segments, &failure));
  if (!parent) return failure;
  const std::string parent_identity = PosixAuthorityId(parent.get());
  if (request.action == "identify") {
    UniqueFd entry(OpenComponent(parent.get(), request.entry_name, O_RDONLY | O_DIRECTORY));
    if (!entry) return Error("tree-identify", errno);
    return State("identified", parent_identity, PosixAuthorityId(entry.get()));
  }
  if (parent_identity != request.expected_parent_identity) return Failure("managed_tree_changed");
  if (request.action == "stage") {
    const bool source_missing = EntryMissing(parent.get(), request.entry_name);
    const bool quarantine_missing = EntryMissing(parent.get(), request.quarantine_name);
    if (source_missing && !quarantine_missing) {
      if (!OpenExpected(parent.get(), request.quarantine_name, request.expected_identity)) {
        return Failure("managed_tree_changed");
      }
      if (!SyncParent(parent.get(), request)) return Indeterminate("managed_tree_quarantine_sync_indeterminate");
      return State("quarantined", parent_identity, request.expected_identity);
    }
    if (source_missing || !quarantine_missing) return Failure("managed_tree_changed");
    Checkpoint(request, "pause-after-tree-final-check");
    UniqueFd verified_parent(OpenParent(root, request.parent_segments, &failure));
    if (!verified_parent || PosixAuthorityId(verified_parent.get()) != parent_identity ||
      !EntryMissing(verified_parent.get(), request.quarantine_name) ||
      !OpenExpected(verified_parent.get(), request.entry_name, request.expected_identity)) {
      return Failure("managed_tree_changed");
    }
    if (renameatx_np(verified_parent.get(), request.entry_name.c_str(), verified_parent.get(),
      request.quarantine_name.c_str(),
      RENAME_EXCL) != 0) return Error("tree-quarantine", errno);
    UniqueFd quarantined(OpenExpected(verified_parent.get(), request.quarantine_name, request.expected_identity));
    UniqueFd rebound(OpenParent(root, request.parent_segments, &failure));
    const bool rollback_requested = request.fault == "tree-stage-rollback-collision" ||
      request.fault == "tree-stage-rollback-sync-failure";
    if (request.fault == "tree-stage-rollback-collision") {
      mkdirat(verified_parent.get(), request.entry_name.c_str(), 0700);
    }
    if (rollback_requested || !quarantined || !rebound || PosixAuthorityId(rebound.get()) != parent_identity) {
      const bool restored = renameatx_np(verified_parent.get(), request.quarantine_name.c_str(), verified_parent.get(),
        request.entry_name.c_str(),
        RENAME_EXCL) == 0;
      const bool identity_restored = restored &&
        static_cast<bool>(OpenExpected(verified_parent.get(), request.entry_name, request.expected_identity));
      const bool rollback_synced = SyncParent(verified_parent.get(), request);
      if (!restored || !identity_restored || !rollback_synced) {
        return Indeterminate("managed_tree_stage_rollback_indeterminate");
      }
      return Failure("managed_tree_changed");
    }
    CrashCheckpoint(request, "crash-after-tree-stage-before-sync");
    if (!SyncParent(verified_parent.get(), request)) {
      return Indeterminate("managed_tree_quarantine_sync_indeterminate");
    }
    return State("quarantined", parent_identity, request.expected_identity);
  }
  if (request.action == "restore") {
    const bool source_missing = EntryMissing(parent.get(), request.entry_name);
    const bool quarantine_missing = EntryMissing(parent.get(), request.quarantine_name);
    if (!source_missing) {
      if (!quarantine_missing || !OpenExpected(parent.get(), request.entry_name, request.expected_identity)) {
        return Failure("managed_tree_exists");
      }
      if (!SyncParent(parent.get(), request)) return Indeterminate("managed_tree_restore_sync_indeterminate");
      return State("restored", parent_identity, request.expected_identity);
    }
    if (quarantine_missing || !OpenExpected(parent.get(), request.quarantine_name, request.expected_identity)) {
      return Failure("managed_tree_changed");
    }
    if (renameatx_np(parent.get(), request.quarantine_name.c_str(), parent.get(), request.entry_name.c_str(),
      RENAME_EXCL) != 0) return Error("tree-restore", errno);
    if (!OpenExpected(parent.get(), request.entry_name, request.expected_identity)) {
      return Indeterminate("managed_tree_restore_identity_indeterminate");
    }
    CrashCheckpoint(request, "crash-after-tree-restore-before-sync");
    if (!SyncParent(parent.get(), request)) return Indeterminate("managed_tree_restore_sync_indeterminate");
    return State("restored", parent_identity, request.expected_identity);
  }
  const bool source_missing = EntryMissing(parent.get(), request.entry_name);
  const bool quarantine_missing = EntryMissing(parent.get(), request.quarantine_name);
  if (!source_missing) return Failure("managed_tree_exists");
  if (quarantine_missing) {
    if (!SyncParent(parent.get(), request)) return Indeterminate("managed_tree_remove_sync_indeterminate");
    return Indeterminate("managed_tree_remove_state_indeterminate");
  }
  UniqueFd quarantined(OpenExpected(parent.get(), request.quarantine_name, request.expected_identity));
  if (!quarantined) return Failure("managed_tree_changed");
  Checkpoint(request, "pause-before-tree-remove");
  UniqueFd verified_parent(OpenParent(root, request.parent_segments, &failure));
  if (!verified_parent || PosixAuthorityId(verified_parent.get()) != parent_identity) {
    return Failure("managed_tree_changed");
  }
  UniqueFd verified(OpenExpected(verified_parent.get(), request.quarantine_name, request.expected_identity));
  if (!verified) return Failure("managed_tree_changed");
  Checkpoint(request, "pause-after-tree-cleanup-open");
  if (!SameEntry(verified_parent.get(), request.quarantine_name, verified.get())) {
    return Failure("managed_tree_changed");
  }
  if (!RemoveVerifiedTreeContents(verified_parent.get(), request.quarantine_name, verified.get())) {
    return SameEntry(verified_parent.get(), request.quarantine_name, verified.get())
      ? Failure("managed_tree_cleanup_incomplete")
      : Failure("managed_tree_changed");
  }
  if (!SameEntry(verified_parent.get(), request.quarantine_name, verified.get()) ||
    unlinkat(verified_parent.get(), request.quarantine_name.c_str(), AT_REMOVEDIR) != 0) {
    return Failure("managed_tree_cleanup_incomplete");
  }
  CrashCheckpoint(request, "crash-after-tree-remove-before-sync");
  if (!SyncParent(verified_parent.get(), request)) return Indeterminate("managed_tree_remove_sync_indeterminate");
  return State("removed", parent_identity, request.expected_identity);
}
}  // namespace owfs
