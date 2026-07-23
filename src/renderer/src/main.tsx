import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { createPreviewApi } from './preview-api'

function isElectronRenderer(): boolean {
  return navigator.userAgent.includes('Electron')
}

function MissingDesktopBridge() {
  return (
    <div className="app-shell bridge-missing-shell">
      <div className="bridge-missing-panel">
        <div className="brand-mark">AW</div>
        <h1>桌面授权桥接未加载</h1>
        <p>请完全退出 AIZZZWatch 后，从桌面快捷入口重新打开。当前窗口不会执行网页登录授权。</p>
      </div>
    </div>
  )
}

const root = ReactDOM.createRoot(document.getElementById('root')!)

if (!window.aizzz && !isElectronRenderer()) window.aizzz = createPreviewApi()

root.render(
  <React.StrictMode>
    {window.aizzz ? <App /> : <MissingDesktopBridge />}
  </React.StrictMode>
)
