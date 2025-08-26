# Paperclip V1.0

## 📱 Application Description

### Paperclip : Tone-Sensitive Writing Assistant for Clear and Culturally-Appropriate Messaging

Paperclip is an AI-powered communication assistant designed to enhance the clarity, politeness, and cultural sensitivity of your messages in real-time. Operating entirely locally on your device, Paperclip ensures maximum data security by eliminating external data transfers, making it ideal for security-sensitive environments.

Leveraging the Qwen2.5-7B-Instruct model optimized with Qualcomm's Genie SDK, Paperclip provides instant tone analysis and context-aware sentence suggestions within one second. It offers at least three refined alternatives per message—polite, neutral-and-direct, and apologetic—to ensure effective communication across diverse cultural contexts, supporting Korean, English, and Japanese languages.

Seamlessly integrated as a desktop editor plug-in or mobile keyboard extension, Paperclip never disrupts your workflow. Its intuitive interface allows quick revision selection via shortcuts, with easy rollback options always available. Whether collaborating globally or navigating complex interpersonal interactions, Paperclip keeps your communications clear, professional, and culturally attuned.



## 👥 Team Members

**Team Leader:** Euntaek Jeong (05temtxi21@gmail.com)

HoYeon An (ahy051012@gmail.com)

Hyunjung Yeon (yeonhj0507@gmail.com)

SeonHo Yoo (leoyoo2004@korea.ac.kr)

# Project Setup Guide

Awesome call — let’s put the **extension install** ahead of the one-touch installer. Drop this block into your README right **before** “Quick Start”.

---

## Step 0 — Install the browser extension (before one-touch install)

You need the extension **installed first**, so we can register the Native Messaging host with the **correct extension ID(s)**.

### Chrome

1. Open `chrome://extensions`.
2. Install your extension:

   * From the Chrome Web Store (recommended), **or**
   * For a local dev build: toggle **Developer mode** → **Load unpacked** → select your extension folder.
3. Click the extension’s **Details** and copy its **ID** (32-character string).

### Microsoft Edge

1. Open `edge://extensions`.
2. Install from the Edge Add-ons store, or use **Load unpacked** for a local folder.
3. Open **Details** and copy the **ID**.

> Don’t see the ID? Enable **Developer mode** on the extensions page.

### (Optional) Brave

Do the same in `brave://extensions`. Copy the ID if you plan to enable Brave support.

---

### Register the IDs with the native host

From the repo’s `scripts` folder (PowerShell):

```powershell
# Register Chrome and/or Edge extension IDs now (recommended)
# Provide whichever you have; you can pass only one side if needed.
.\register_native_host.ps1 `
  -ChromeExtIds "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" `
  -EdgeExtIds   "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

```

* You can list **multiple** IDs per browser: `-ChromeExtIds "id1","id2"`.
* If you skip this step, the installer will register **placeholder IDs**, and the extension won’t connect until you re-run `register_native_host.ps1` with real IDs.

---

## Quick Start

From a PowerShell window in the repo’s `scripts` folder:

```powershell
# ARM64 Windows (e.g., Snapdragon X)
.\install_all.ps1 -Arch arm64
```

This builds the native DLL/EXE, deploys to `%LOCALAPPDATA%\PaperClip`, finalizes Native Messaging registration, and runs a smoke test. Logs land in `logs\install\*.log`.

---

## Requirements

* **Windows 10/11** (ARM64)
* **Visual Studio 2022** with MSVC v143 and Windows 10/11 SDK
* **MSBuild** (installed with VS)
* **PowerShell 5.1+**
* **Qualcomm AI Stack / Genie SDK / QNN SDK** for accelerated runtime DLLs

---

## Populate `runtime\genie_bundle` (runtime files)

The installer copies the repo’s `runtime\genie_bundle` to `%LOCALAPPDATA%\PaperClip\genie_bundle` and adds it to the host’s DLL search path. Fill it with the runtime DLLs your build needs.

1. Create the folder

```powershell
New-Item -ItemType Directory -Force -Path .\runtime\genie_bundle | Out-Null
```

2. What to place inside (typical)

* `Genie.dll`
* QNN/HTP runtime DLLs: `QnnHtp.dll`, `QnnHtpPrepare.dll`, `QnnSystem.dll`, …
* (Optional DSP) `lib\hexagon-v73\unsigned\*`
* Any additional runtime dependencies

3. Example copy snippet (ARM64)

```powershell
$QAIRT = "C:\Qualcomm\AIStack\QAIRT\2.37.1.250807"
Copy-Item "$QAIRT\lib\aarch64-windows-msvc\*" ".\runtime\genie_bundle\" -Force -ErrorAction SilentlyContinue
if (Test-Path "$QAIRT\lib\hexagon-v73\unsigned") {
  Copy-Item "$QAIRT\lib\hexagon-v73\unsigned\*" ".\runtime\genie_bundle\" -Recurse -Force -ErrorAction SilentlyContinue
}
$genie = Get-ChildItem $QAIRT -Filter "Genie.dll" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($genie) { Copy-Item $genie.FullName ".\runtime\genie_bundle\" -Force }
```

> **x64 target:** use the matching `lib\x64-windows-msvc` (or equivalent) folder.
> **Git tip:** Large DLLs shouldn’t be committed; consider **Git LFS** if you must version them.

---

## Install Genie / QNN SDK & set `QNN_SDK_ROOT`

1. Install the SDK(s): **QAIRT / Genie SDK / QNN SDK** as needed. Ensure you have:

* `...\include\Genie\`, `...\lib\{arch}\`, (optional) `...\lib\hexagon-v73\unsigned\`, and a `Genie.dll` somewhere under the install tree.

2. Set `QNN_SDK_ROOT`:

```powershell
$QNN = "C:\Qualcomm\AIStack\QAIRT\2.37.1.250807"
[Environment]::SetEnvironmentVariable('QNN_SDK_ROOT', $QNN, 'User')
$libPath = Join-Path $QNN "lib\aarch64-windows-msvc"  # or x64-windows-msvc
if (Test-Path $libPath) { $env:Path += ";$libPath" }
[Environment]::GetEnvironmentVariable('QNN_SDK_ROOT','User')
```

Now run the **Quick Start** installer.



## 📦 Dependencies and Licenses

### Chrome Extension

No third-party libraries are used. The extension relies solely on standard web technologies and Chrome APIs.


## 📄 License

This project is licensed under the [MIT License](./LICENSE) by Paperclip Team.
