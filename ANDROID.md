# Android 版本

项目使用 Capacitor 将现有网页封装为 Android WebView 应用。

## 功能范围

- 图纸、点位、搜索和标点数据离线内置。
- 使用手机压缩图和按楼层加载，避免一次渲染全部点位。
- 手机本地修改保存在 WebView 本地存储中。
- 纯 APK 环境没有 Node 服务，因此 `/api` 同步、资料上传和服务器删除不可用。
- 最低支持 Android 7.0（API 24）。

## 本机构建

需要安装 Android Studio（包含 JDK 21 和 Android SDK 36）。

```powershell
npm ci
npm run android:open
```

Android Studio 打开后，使用 `Build > Build APK(s)`。

也可以直接运行：

```powershell
npm run android:apk
```

调试 APK 输出位置：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## GitHub 构建

推送到 `main` 后，GitHub Actions 的 `Build Android APK` 会自动运行。
也可以在 Actions 页面手动运行该工作流，然后下载
`baggage-smart-search-debug-apk` 构建产物。

## 更新网页资源

每次修改网页、图纸或点位数据后执行：

```powershell
npm run android:sync
```

该命令只复制运行必需文件，不会把 PDF 原件和 Excel 源文件打进 APK。
