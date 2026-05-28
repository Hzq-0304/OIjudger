# OIjudger

OIjudger is a VSCode extension for local OI-style sample judging.

First-version features:

- Initialize `.oitest/config.json`
- Create a problem without immediately binding a source file
- Bind a local statement file (`.md`, `.pdf`, or `.txt`) to a problem
- Add one or more C++ programs to a problem and choose a default program
- Add multiple samples under `.oitest/samples` or `.oitest/problems/<problemId>/samples`
- Add samples by pasting text or selecting input/output files
- Batch add samples from a folder by matching input and answer suffixes
- Delete samples from the OIjudger sidebar
- Set time and memory limits
- Automatically set Windows MinGW/g++ stack size from the memory limit
- Detect or select a local C++ compiler
- Compile the active C++ file with `g++`
- Run all configured samples
- Compare standard output
- Save user output and `.oitest/outputs/report.json`
- Show an `OIjudger` sidebar with current file, limits, sample status, and quick actions
- Open report and sample detail pages from the sidebar
- Switch UI text with `oijudger.language` (`auto`, `en`, `zh`)
- Manage multiple problems in one workspace with `.oitest/problems.json`
- Keep legacy single-problem `.oitest/config.json` data intact and import it when needed

Problem workflow:

- `OIjudger: Create Problem` creates a problem entry and its `.oitest/problems/<problemId>/` folders without requiring a source file.
- `OIjudger: Bind Statement` links a statement file. OIjudger stores the original file path only; it does not copy, modify, or delete the statement file.
- `OIjudger: Add Program To Problem` links a C++ program. Programs are path references only; source files are not copied into `.oitest`.
- `OIjudger: Set Default Program` chooses the program used by `Run All Samples`.
- `OIjudger: Run Samples With Program` lets you temporarily choose any linked or newly selected `.cpp` file for one run.
- `OIjudger: Add Problem From Current File` and `OIjudger: Add Problem From File` still work as shortcuts: they create a problem and set the selected file as the default program.

Tree view:

- Problem nodes are collapsed by default to keep the OIjudger sidebar compact after VSCode restarts.
- Expand a problem manually to view Statement, Programs, Limits, Samples, and Actions.
- Samples and Actions are also collapsed by default, which keeps large multi-sample problems easier to scan.
- Click the Time, Memory, or Stack node under a problem's Limits section to edit the corresponding limit. These limit editors are not duplicated in the Actions section.

Sample storage:

- Paste manually: OIjudger stores the input and expected output inside `.oitest`. This is best for small samples.
- Select input/output files: OIjudger stores the original absolute file paths and does not copy the files. This is best for large data files or existing local test data.
- External samples depend on the original files. If an external input or answer file is moved or deleted, the sample is shown as `Missing` and skipped during judging.
- Deleting a managed sample removes the OIjudger-owned `.oitest` sample files and generated outputs.
- Deleting an external sample removes only the OIjudger sample record and generated outputs. The original input and answer files are never deleted.

Batch add samples:

- Run `OIjudger: Batch Add Samples`.
- Enter the input file suffix. The default is `.in`; `in` is normalized to `.in`.
- Enter the answer file suffix. The default is `.out`; `ans` is normalized to `.ans`.
- Select a samples folder.
- OIjudger scans only the first level of that folder and matches files by `basename + inputSuffix` and `basename + answerSuffix`.
- For example, `1.in` with `1.out` and `2.in` with `2.out` are added as two samples.
- Batch-added samples are external samples: OIjudger stores absolute paths only and does not copy or modify the files.
- Inputs without matching answer files and duplicate sample pairs are skipped and summarized.

Sample names:

- Manually pasted samples keep the default `Sample x` name.
- Samples added from files use the input file basename as the visible sample name.
- For example, `book3.in` with `book3.ans` is shown as `book3`; `1.in` with `1.out` is shown as `1`.
- Batch-added samples use each matched basename as the sample name.
- OIjudger still uses a stable internal `id` and `index` for output folders such as `outputs/sample-7/`, so display names do not affect deletion, reports, or diff paths.
- If a sample name already exists, OIjudger appends ` (2)`, ` (3)`, and so on.

Sample viewing:

- Sample input, expected output, and run results open in the native VSCode text editor.
- Output differences open with the native VSCode Diff Editor.
- New per-problem runs keep pure stdout in `.oitest/problems/<problemId>/outputs/sample-x/useroutput.txt` for judging and diff.
- `Run Result` opens `.oitest/problems/<problemId>/outputs/sample-x/run-result.txt`, which contains program stdout, program stderr, and runtime diagnostics such as status, exit code, signal, and Runtime Error details.
- The standalone `Open Stderr` sample action has been removed; stderr is shown through `Run Result`.
- Checker output is separate: checker stdout and stderr are merged into `checker-output.txt` and opened with `Checker Output`.
- `Diff` and judging still use pure `useroutput.txt`; stderr is never appended to it.
- New per-problem runs also keep `stderr.txt` and `diff.txt` next to the output for diagnostics and compatibility.
- Older `1.out`, `1.err`, and `1.diff` outputs remain readable for compatibility.

Timing note: sample time only measures the user executable process. On Windows, sample time includes process startup and pipe I/O overhead, so very small programs may still show tens of milliseconds.

计时说明：样例时间只统计用户程序进程运行阶段。在 Windows 上，样例运行时间包含进程启动和管道 I/O 开销，因此极小程序也可能显示几十毫秒。

Windows stack size:

- Deep recursive programs on Windows may exit with `0xC00000FD`, which is a stack overflow exception.
- By default, OIjudger follows the problem memory limit and adds a MinGW/g++ linker flag when compiling on Windows.
- For `memoryMb = 256`, the generated flag is `-Wl,--stack,268435456`.
- Click the Stack node under a problem's Limits section, or run `OIjudger: Set Stack Size`, to choose `Follow Memory Limit`, `Custom Stack Size`, or `Disable Auto Stack Size`.
- The stack flag is generated at compile time and is not repeatedly inserted into `compile.args`.
- If auto stack size is enabled, an existing `-Wl,--stack,...` argument is replaced by the current setting. If auto stack size is disabled, OIjudger does not add a stack flag.
- This mainly targets Windows + MinGW/g++. Linux/macOS judging environments usually control stack through the runner or system limits, and avoiding very deep recursion is still the safest algorithmic choice.

Runtime Error Explanation:

- OIjudger explains common Runtime Error results from the process exit code or POSIX signal.
- Runtime Error names use common OI/OJ-style English descriptions, such as:
  - Stack overflow
  - Access violation
  - Integer divide by zero
  - Floating point exception
  - Segmentation fault
- Chinese UI keeps the English Runtime Error title and adds Chinese descriptions, possible causes, and suggestions below it.
- Common Windows examples:
  - `0xC00000FD`: Stack overflow
  - `0xC0000005`: Access violation
  - `0xC0000094`: Integer divide by zero
- Common Linux/macOS signals:
  - `SIGSEGV`: Segmentation fault
  - `SIGFPE`: Floating point exception
  - `SIGABRT`: Aborted
- The explanation is a diagnostic hint, not a final proof. Always combine it with the input file, stderr, the reproduction command, and a debugger when needed.

Judge Mode:

- OIjudger supports two judge modes for each problem:
  - Normal text compare
  - Custom checker
- Normal text compare directly compares the user program stdout with the expected output file. This is the default mode and fits most ordinary OI problems.
- In normal text compare mode, Checker-related actions are hidden from the problem Actions section to keep the sidebar compact.
- Click the Judge Mode node under a problem to switch between normal text compare and custom checker.
- Custom checker mode enables Checker actions and supports:
  - Testlib Checker
  - Plain Checker
- If you run `OIjudger: Set Checker` while a problem is still in normal text compare mode, OIjudger asks whether to switch to custom checker first.
- Switching back to normal text compare does not delete the saved checker configuration, so you can switch back later without reselecting the checker.

Testlib Checker:

- OIjudger supports first-version testlib-style checkers for per-problem judging.
- Run `OIjudger: Set Checker` and choose `Testlib checker`, then select a local `checker.cpp`.
- A typical checker includes `#include "testlib.h"` and calls `registerTestlibCmd(argc, argv)`.
- OIjudger runs the checker as:

```text
checker.exe input.txt useroutput.txt answer.txt
```

- `testlib.h` is resolved in this order:
  - the same folder as `checker.cpp`
  - the workspace root
  - `.oitest/tools/testlib/testlib.h`
  - a custom path recorded in the checker config
- OIjudger can install the bundled `testlib.h` shipped with the extension, or import a local copy selected by the user.
- User-provided copies still have higher priority than the bundled copy once installed into the workspace.
- OIjudger does not download or generate `testlib.h`. If it is missing, run `OIjudger: Import testlib.h`.
- When bundled resources are available, `OIjudger: Import testlib.h` offers:
  - `Install bundled testlib.h`
  - `Import testlib.h from local file`
- Bundled source and license details are preserved in `resources/testlib/README.md` and `resources/testlib/LICENSE`.
- Checker executables are built under `.oitest/problems/<problemId>/checker/`.
- Checker stdout and stderr are merged into one file beside each sample output as `checker-output.txt`.
- testlib checkers often print verdict details to stderr; users can still view all checker information through the single `Checker Output` action.
- Plain Checker verdict parsing still uses only the last non-empty line of the original stdout. Merged stderr content is saved for viewing, but it is not parsed as the verdict.
- First-version verdict rules:
  - checker exit code `0` => `AC`
  - checker exit code `1` => `WA`
  - Windows NTSTATUS exception codes such as `0xC0000135` => `Checker Error`
  - checker compile/run/timeout failure => `Checker Error`
- Windows DLL note:
  - If a checker exits with code `3221225781` / `0xC0000135`, it usually means `checker.exe` failed to start because a runtime DLL is missing, not that the checker judged `WA`.
  - Common missing DLLs include MinGW `libstdc++-6.dll`, `libgcc_s_seh-1.dll`, and `libwinpthread-1.dll`.
  - OIjudger tries to compile checkers with static linking for MinGW/g++ and prepends the compiler `bin` directory to the checker process `PATH`.
  - You can also add the MinGW `bin` directory to `PATH`, rebuild the checker with static linking, or put the missing DLL next to `checker.exe`.
- Normal compare is unchanged when no checker is enabled.
- Later versions may add `score-json`, `score-plain`, and partial score checker protocols.

Plain Checker:

Plain Checker is a simple custom checker that does not depend on `testlib.h`.

OIjudger runs it with the same arguments as a testlib checker:

```text
checker.exe input.txt useroutput.txt answer.txt
```

The last non-empty line of stdout must be one of:

- `AC`
- `WA`
- a numeric score

Examples:

```text
AC
```

This marks the sample as accepted.

```text
WA
```

This marks the sample as wrong answer.

```text
37.5
```

This returns a score of `37.5`. OIjudger shows a question mark icon and displays `37.5` on the right side. It does not mark the sample as accepted or wrong.

Important: if you want WA, output `WA`. If you output `0`, OIjudger treats it as score `0`, not as WA. If you output `100`, OIjudger treats it as score `100`, not as AC.

Invalid final lines include:

- `Accepted`
- `Wrong Answer`
- `75%`
- `score: 75`
- `通过`

These are reported as `Checker Error`.

Minimal Plain Checker example:

```cpp
#include <bits/stdc++.h>
using namespace std;

int main(int argc, char** argv) {
    if (argc < 4) {
        cout << "WA\n";
        return 0;
    }

    ifstream user(argv[2]);
    ifstream ans(argv[3]);

    long long a, b;
    user >> a;
    ans >> b;

    cout << (a == b ? "AC" : "WA") << '\n';
    return 0;
}
```

Score example:

```cpp
#include <bits/stdc++.h>
using namespace std;

int main(int argc, char** argv) {
    ifstream user(argv[2]);
    ifstream ans(argv[3]);

    int correct = 0, total = 10;
    for (int i = 0; i < total; i++) {
        int x, y;
        if (!(user >> x)) break;
        ans >> y;
        if (x == y) correct++;
    }

    cout << fixed << setprecision(1) << correct * 10.0 << '\n';
    return 0;
}
```

If the last line is `70.0`, OIjudger shows a question mark icon and score `70.0`.

Commands:

- `OIjudger: Init Problem`
- `OIjudger: Add Sample`
- `OIjudger: Run All Samples`
- `OIjudger: Set Time Limit`
- `OIjudger: Set Memory Limit`
- `OIjudger: Set Stack Size`
- `OIjudger: Open Last Report`
- `OIjudger: Clear Outputs`

The default compiler command is `g++`. You can edit `.oitest/config.json` to adjust compiler flags.

## Development

From the project root:

```powershell
npm install
npm run compile
npm pack --dry-run
```

Press F5 in VSCode and choose `Run OIjudger Extension` to open the Extension Development Host.
