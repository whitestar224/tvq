# TVQ

TradingView 桌面端合约快捷跳转工具（Electron 版）。

## 功能

- 跟随当前屏幕识别 TradingView 币种
- 一键打开对应交易所合约页
- 悬浮窗始终置顶
- 自定义标题栏（隐藏、最大化、关闭）
- 返佣信息弹窗与开发者微信复制
- 更新检测与下载更新

## 下载

- Release: https://github.com/whitestar224/tvq/releases

## 更新机制

程序读取 `update-config.json` 中的 `manifestUrl`，拉取远程更新清单。

`update-config.json` 示例：

```json
{
  "enabled": true,
  "checkIntervalMinutes": 15,
  "manifestUrl": "https://raw.githubusercontent.com/whitestar224/tvq/main/update-manifest.json",
  "channel": "stable"
}
```

`update-manifest.json` 示例：

```json
{
  "version": "1.0.0",
  "notes": "TVQ Electron 首个稳定版。",
  "setupUrl": "https://github.com/whitestar224/tvq/releases/download/v1.0.0/TVQ-Setup-1.0.0.exe",
  "portableUrl": "https://github.com/whitestar224/tvq/releases/download/v1.0.0/TVQ-Portable-1.0.0.exe",
  "publishedAt": "2026-04-02"
}
```

## 本地开发

```bash
npm install
npm start
```

## 打包

```bash
npm run dist
```

## 目录

- `main.js`: 主进程逻辑（检测、更新、置顶）
- `renderer.js`: 前端交互
- `tvq_detect.ahk`: TradingView 窗口与币种检测
- `update-config.json`: 更新源配置
- `update-manifest.json`: 远程更新清单

## 作者

- 微信：`whitestar0224`
