# DSH Next 启动动画

为 DeepSeek Harness Next 提供白色启动画面。彩虹手写笔迹逐笔写出 **Welcome to DSH.**，收拢为鲸鱼标志，再淡入主界面。默认动画约 3.6 秒。DSH 同时在后台加载，若主界面尚未就绪，启动器会停留在鲸鱼画面。

Windows 启动器使用 C++、Direct2D 和 DirectWrite，按窗口实际像素实时绘制，通过双缓冲更新画面。安装器使用 DSH 自带的插件管理机制。运行只需要 Windows 系统组件和已安装的 DSH Next。

## 安装

1. 从 [最新 Release](https://github.com/DreamYuande/dsh-hello-splash/releases/latest) 下载 Windows x64 安装 ZIP。
2. 打开过一次 DSH Next，让它创建 desktop Profile，再从「应用」菜单选择「退出」。
3. 解压整个 ZIP，双击 **安装.cmd**。以后使用桌面的 **DSH Next 白色启动**，或者安装器更新的现有 **DSH Next** 快捷方式。

已验证 **DSH Next 2.0.24-next**（DSH Runtime **0.2.2-rc.5**）和 Windows x64。启动器 EXE 未签名。首次安装需要已初始化的 DSH desktop Profile。

单独安装 Release 中的 **dsh-hello-splash-\*.tgz** 可以体验 DSH 内的插件功能。包含 Windows 启动器和快捷方式的完整方案请使用 ZIP。

## 设置与备份

在 **设置 → Welcome splash** 调整自动播放、文字、背景、时长、形变、副标题和 Esc 跳过。也可在这里预览。自定义文字由 DSH 内的 SVG 动画绘制。系统减少动态效果开启时，自动跳过动画。

安装数据保存在 desktop Profile 的 **plugin-data/dsh-hello-splash**。换电脑时，用 ZIP 重新安装。有自定义设置时，可另备份 **config.json** 并放回同一目录。停用或卸载插件通过 DSH 插件管理器完成。

## 从源码构建

需要 Node.js 20 或更新版本、pnpm 和 LLVM-MinGW 的 Windows x64 UCRT 工具链。

    ./scripts/package-release.ps1 -Compiler 'C:\path\to\x86_64-w64-mingw32-clang++.exe'

构建脚本生成共享矢量几何、JavaScript 客户端、C++ 启动器和一键安装 ZIP。结果位于 **.release**。修改版本时，同步更新 package.json、src/00-core.js 和 launcher/native/install.cpp 中的安装包版本。

手写路径位于 **src/10-script.js**，鲸鱼轮廓和笔迹分配位于 **src/20-logo.js**，播放流程位于 **src/30-scene.js**。原生 Windows 绘制位于 **launcher/native**。可用 **node dev/serve.mjs** 启动本地预览，再在浏览器访问 **127.0.0.1:4173/dev/play.html**。

## 许可

插件代码采用 [MIT 许可](LICENSE)。鲸鱼路径来自 DSH 的 FishLogo，采用 [DeepSeek 的 MIT 许可](docs/DeepSeek-LICENSE.txt)。原生启动器使用 [nlohmann/json](launcher/native/vendor/nlohmann/LICENSE.MIT)。
