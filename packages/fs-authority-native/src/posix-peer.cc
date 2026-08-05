#include "peer.h"
#include <sys/socket.h>
#include <unistd.h>
namespace owfs { bool VerifyLocalPeer(std::uint64_t descriptor, bool) { const int socket = static_cast<int>(descriptor);
  uid_t user = 0; gid_t group = 0; return getpeereid(socket, &user, &group) == 0 && user == geteuid();
} }
