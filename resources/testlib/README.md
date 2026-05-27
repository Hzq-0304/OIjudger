# Bundled testlib.h

This directory contains the bundled `testlib.h` used by OIjudger as an optional fallback for testlib checkers.

Version/source archive used during bundling:

- `testlib-0.9.41.zip`

OIjudger does not force users to use this bundled copy. The resolver still prefers:

1. `testlib.h` next to `checker.cpp`
2. `testlib.h` in the workspace root
3. `.oitest/tools/testlib/testlib.h`
4. custom configured `testlib.h`
5. this bundled copy, only when the user installs/imports it into the managed directory

License information is preserved in `LICENSE`.
