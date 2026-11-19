# Ubuntu FFmpeg archives for recipient CI

Repository checks and Connect delivery refresh signed Ubuntu indexes and resolve
FFmpeg against the Ubuntu 24.04 x64 runner. The cache key follows the resolved
archive filenames and SHA-256 hashes. Archives from earlier runner images can be
reused when their hashes match. APT downloads missing or invalid archives through
its existing signed transport, then installs the verified set without further
downloads. Default-branch pushes save complete sets for future jobs. Cached
archives carry no test results or release evidence.

Manual platform verification, native tests and AppImage packaging use their
existing signed APT setup. To roll back the optimization, restore the signed
APT FFmpeg install in the portable jobs of `checks.yml` and `stream-connect.yml`.
