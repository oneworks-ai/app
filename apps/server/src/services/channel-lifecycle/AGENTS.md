# Channel Lifecycle Service

This service commits terminal child-run audit and records delivered outbound turns. Both operations are idempotent because adapter stop/exit paths can arrive more than once.
