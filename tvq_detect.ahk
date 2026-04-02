#Requires AutoHotkey v2.0
#SingleInstance Force

SetTitleMatchMode 2
DetectHiddenWindows true

x := 0
y := 0
if (A_Args.Length >= 2) {
    x := Number(A_Args[1])
    y := Number(A_Args[2])
}
mode := ""
if (A_Args.Length >= 3) {
    mode := A_Args[3]
}

if (mode = "alert") {
    alertSym := DetectAlertSymbol()
    FileAppend(alertSym, "*")
    ExitApp
}

monitor := GetMonitorByPoint(x, y)
hwnd := GetTradingViewWindowForMonitor(monitor)
if !hwnd {
    hwnd := GetPrimaryTradingViewWindow()
}
symbol := ""
if (hwnd) {
    symbol := ExtractSymbolFromTitle(WinGetTitle("ahk_id " hwnd))
}
FileAppend(monitor "|" symbol, "*")

DetectAlertSymbol() {
    for _, hwnd in WinGetList("ahk_exe TradingView.exe") {
        title := ""
        try title := WinGetTitle("ahk_id " hwnd)
        if (title = "") {
            continue
        }
        if !(InStr(title, "警报") || InStr(title, "Alert")) {
            continue
        }
        sym := ExtractSymbolFromTitle(title)
        if (sym != "") {
            return sym
        }
    }
    return ""
}

GetMonitorByPoint(x, y) {
    monitorCount := MonitorGetCount()
    Loop monitorCount {
        m := A_Index
        MonitorGetWorkArea(m, &l, &t, &r, &b)
        if (x >= l && x < r && y >= t && y < b) {
            return m
        }
    }
    return 1
}

GetPrimaryTradingViewWindow() {
    bestHwnd := 0
    bestArea := 0
    for _, hwnd in WinGetList("ahk_exe TradingView.exe") {
        title := ""
        x := y := w := h := 0
        try title := WinGetTitle("ahk_id " hwnd)
        try WinGetPos(&x, &y, &w, &h, "ahk_id " hwnd)
        if (w < 300 || h < 200) {
            continue
        }
        area := w * h
        if (title != "") {
            area += 100000000
        }
        if (area > bestArea) {
            bestArea := area
            bestHwnd := hwnd
        }
    }
    return bestHwnd
}

GetTradingViewWindowForMonitor(monitorIndex) {
    MonitorGetWorkArea(monitorIndex, &l, &t, &r, &b)
    bestHwnd := 0
    bestScore := 0
    for _, hwnd in WinGetList("ahk_exe TradingView.exe") {
        title := ""
        wx := wy := ww := wh := 0
        try title := WinGetTitle("ahk_id " hwnd)
        try WinGetPos(&wx, &wy, &ww, &wh, "ahk_id " hwnd)
        if (ww < 300 || wh < 200) {
            continue
        }
        area := RectOverlapArea(wx, wy, ww, wh, l, t, r, b)
        if (area <= 0) {
            continue
        }
        score := area
        if (title != "") {
            score += 100000000
        }
        if (score > bestScore) {
            bestScore := score
            bestHwnd := hwnd
        }
    }
    return bestHwnd
}

RectOverlapArea(wx, wy, ww, wh, l, t, r, b) {
    wr := wx + ww
    wb := wy + wh
    overlapLeft := Max(wx, l)
    overlapTop := Max(wy, t)
    overlapRight := Min(wr, r)
    overlapBottom := Min(wb, b)
    ow := overlapRight - overlapLeft
    oh := overlapBottom - overlapTop
    if (ow <= 0 || oh <= 0) {
        return 0
    }
    return ow * oh
}

ExtractSymbolFromTitle(title) {
    if RegExMatch(title, "i)([A-Z0-9]+:[A-Z0-9._-]+)", &m1) {
        return m1[1]
    }
    if RegExMatch(title, "i)\b([A-Z0-9]{3,}(USDT|USDC|USD|BUSD|FDUSD|BTC|ETH)(\.P|\.PERP|PERP)?)\b", &m2) {
        return "BINANCE:" m2[1]
    }
    return ""
}
