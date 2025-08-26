# About Paperclip

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

## 🧩 Dependencies & Build Instructions

### 🧱 Chrome Extension

No installation is required.

To install the extension:

1. Open Chrome and go to
```
chrome://extensions
```

2. Enable **Developer Mode** (toggle switch at the top right).

3. Click **"Load unpacked"** and select the **root directory** of this project.

---

### 🖥️ Flutter Tray App

This project uses [Flutter](https://flutter.dev/docs/get-started/install). Please ensure it is installed before continuing.

#### Step 1: Install Dependencies

Navigate to the `flutter_tray_app` directory and run:

```
flutter pub get
```

#### Step 2: Run the App
Use the following command to run the app:
(Replace {your own openAI key} with your actual OpenAI API key)

```
flutter run -d windows --dart-define=OPENAI_API_KEY={your own openAI key}
```

### ✅ Verifying the Setup
Once the app is running and the Chrome extension is loaded, you should see:
```
Extension Connected
```

This means everything is working correctly!



## 📦 Dependencies and Licenses

### Flutter Tray App

This project uses the following open-source packages:

- [Flutter](https://flutter.dev) – BSD 3-Clause License  
- [tray_manager](https://pub.dev/packages/tray_manager) – MIT License  
- [window_manager](https://pub.dev/packages/window_manager) – MIT License  
- [http](https://pub.dev/packages/http) – BSD 3-Clause License  

All licenses are permissive and compatible with the MIT License used by this project.

### Chrome Extension

No third-party libraries are used. The extension relies solely on standard web technologies and Chrome APIs.


## 📄 License

This project is licensed under the [MIT License](./LICENSE) by Paperclip Team.
