"""
F-Aistudio Admin Monitor — API Key + User + Billing Management
NanoBanana Team
"""
import sys, os, json, uuid, time, datetime, csv, hashlib
import bcrypt
import sqlite3
import requests
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QTabWidget, QTableWidget, QTableWidgetItem, QPushButton,
    QLineEdit, QLabel, QComboBox, QMessageBox, QHeaderView,
    QGroupBox, QInputDialog, QDateEdit, QTextEdit, QDialog,
    QFormLayout, QDialogButtonBox, QCheckBox
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QDate
from PyQt6.QtGui import QFont, QColor

# ── Paths ──
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(SCRIPT_DIR)
BACKEND_DIR = os.path.join(BASE, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import runtime_paths
from activity_logger import event_group, event_label, normalize_event, log_activity as shared_log_activity

runtime_paths.ensure_runtime_dirs()

KEYS_FILE = runtime_paths.API_KEYS_FILE
DB_PATH = runtime_paths.LOCAL_SQLITE_FILE
BILLING_FILE = runtime_paths.BILLING_HISTORY_FILE
ROLES_FILE = runtime_paths.ROLES_CONFIG_FILE
PASSWORDS_FILE = runtime_paths.USER_PASSWORDS_FILE
LOGS_FILE = runtime_paths.ACTIVITY_LOGS_FILE
SYSTEM_SETTINGS_FILE = runtime_paths.SYSTEM_SETTINGS_FILE

# ── API URLs ──
KIE_BASE = "https://api.kie.ai"
PIAPI_BASE = "https://api.piapi.ai"
BACKEND_API_BASE = os.getenv("VIDEOTOOL_API_BASE", "http://127.0.0.1:8012").rstrip("/")

# ── Brand colors ──
BG = "#1A1A1C"; CARD = "#2A2A2C"; ORANGE = "#D97A2B"; RED = "#C44A3A"
GREEN = "#6FAF4F"; YELLOW = "#F2D479"; TEXT = "#E8E0D4"; MUTED = "#9a7d5c"; BORDER = "#3A3A3C"

GLOBAL_SS = f"""
    QMainWindow, QDialog {{ background: {BG}; }}
    QLabel {{ color: {TEXT}; font-size: 11px; }}
    QLineEdit, QDateEdit, QTextEdit {{
        background: {CARD}; color: {TEXT}; border: 1px solid {BORDER};
        border-radius: 4px; padding: 4px 8px; font-size: 11px;
    }}
    QComboBox {{
        background: {CARD}; color: {TEXT}; border: 1px solid {BORDER};
        border-radius: 4px; padding: 4px 8px; font-size: 11px;
    }}
    QCheckBox {{ color: {TEXT}; font-size: 11px; spacing: 6px; }}
    QCheckBox::indicator {{ width: 14px; height: 14px; }}
    QPushButton {{
        background: {CARD}; color: {TEXT}; border: 1px solid {BORDER};
        border-radius: 4px; padding: 6px 14px; font-size: 11px;
    }}
    QPushButton:hover {{ background: {BORDER}; }}
    QTableWidget {{
        background: {BG}; color: {TEXT}; border: 1px solid {BORDER};
        gridline-color: {BORDER}; font-size: 11px;
    }}
    QTableWidget::item {{ padding: 4px; }}
    QHeaderView::section {{
        background: {CARD}; color: {ORANGE}; border: 1px solid {BORDER};
        padding: 4px; font-weight: bold; font-size: 10px;
    }}
    QHeaderView {{ background-color: {BG}; }}
    QTableCornerButton::section {{ background-color: {CARD}; border: 1px solid {BORDER}; }}
    QTabWidget::pane {{ border: 1px solid {BORDER}; background: {BG}; }}
    QTabBar::tab {{
        background: {CARD}; color: {MUTED}; padding: 8px 20px;
        border: 1px solid {BORDER}; font-size: 11px; font-weight: bold;
    }}
    QTabBar::tab:selected {{ background: {BG}; color: {ORANGE}; border-bottom: 2px solid {ORANGE}; }}
    QGroupBox {{
        background: {CARD}; border: 1px solid {BORDER}; border-radius: 6px;
        padding: 12px; margin-top: 8px; font-size: 11px; color: {ORANGE};
    }}
    QGroupBox::title {{ subcontrol-origin: margin; left: 10px; padding: 0 4px; }}
    QDialogButtonBox QPushButton {{ padding: 8px 20px; }}
"""


class CreditChecker(QThread):
    result = pyqtSignal(str, str, float)

    def __init__(self, provider, keys):
        super().__init__()
        self.provider = provider
        self.keys = keys

    def run(self):
        for key in self.keys:
            cr = self._check(key)
            self.result.emit(self.provider, key, cr)

    def _check(self, key):
        try:
            if self.provider == "provider1":
                r = requests.get(f"{KIE_BASE}/api/v1/chat/credit",
                                 headers={"Authorization": f"Bearer {key}"}, timeout=10)
                data = r.json()
                raw = data.get("data", 0)
                if isinstance(raw, (int, float)): return float(raw)
                if isinstance(raw, dict):
                    return float(raw.get("credits") or raw.get("balance") or raw.get("points") or 0)
                return 0.0
            else:
                r = requests.get(f"{PIAPI_BASE}/account/info",
                                 headers={"x-api-key": key}, timeout=10)
                data = r.json()
                if r.status_code == 200 and data.get("code") == 200:
                    return float(data.get("data", {}).get("equivalent_in_usd", 0) or 0)
                return 0.0
        except Exception:
            return -1


class AdminMonitor(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("F-Aistudio Admin Monitor")
        self.setMinimumSize(850, 600)
        self._credit_cache = {}
        self._workers = []
        self.setStyleSheet(GLOBAL_SS)

        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(12, 12, 12, 12)

        # Header
        hdr_row = QHBoxLayout()
        hdr = QLabel("F-Aistudio Admin Monitor")
        hdr.setFont(QFont("Segoe UI", 16, QFont.Weight.Bold))
        hdr.setStyleSheet(f"color: {ORANGE};")
        hdr_row.addWidget(hdr)
        hdr_row.addStretch()
        self.total_lbl = QLabel("Dang tai...")
        self.total_lbl.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        self.total_lbl.setStyleSheet(f"color: {GREEN};")
        hdr_row.addWidget(self.total_lbl)
        root.addLayout(hdr_row)

        # Tabs
        tabs = QTabWidget()
        root.addWidget(tabs)

        key_tab = QWidget(); tabs.addTab(key_tab, "API Keys")
        self._build_key_tab(key_tab)

        billing_tab = QWidget(); tabs.addTab(billing_tab, "Lich su nap tien")
        self._build_billing_tab(billing_tab)

        user_tab = QWidget(); tabs.addTab(user_tab, "Quan ly User")
        self._build_user_tab(user_tab)

        logs_tab = QWidget(); tabs.addTab(logs_tab, "Logs")
        self._build_logs_tab(logs_tab)

    def _monitor_log(self, action: str, detail: str = "", credits: float = 0, provider: str = "monitor"):
        try:
            shared_log_activity("admin_monitor", action, detail, credits, provider)
        except Exception:
            pass
        try:
            if hasattr(self, "_logs_data"):
                self._load_logs()
        except Exception:
            pass

    # ══════════════════════════════════════
    # TAB 1: API KEYS
    # ══════════════════════════════════════
    def _build_key_tab(self, parent):
        lay = QVBoxLayout(parent); lay.setSpacing(8)

        # Provider 1
        g1 = QGroupBox("Provider 1 — KIE")
        g1_lay = QVBoxLayout(g1)
        self.p1_total = QLabel("Tong: ...")
        self.p1_total.setStyleSheet(f"color:{GREEN}; font-weight:bold; font-size:12px;")
        g1_lay.addWidget(self.p1_total)
        self.p1_table = QTableWidget(0, 5)
        self.p1_table.setHorizontalHeaderLabels(["#", "API Key", "So du (Credits)", "Runtime", ""])
        self.p1_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.p1_table.setColumnWidth(0, 30); self.p1_table.setColumnWidth(2, 120); self.p1_table.setColumnWidth(3, 150); self.p1_table.setColumnWidth(4, 60)
        g1_lay.addWidget(self.p1_table)
        p1r = QHBoxLayout()
        self.p1_input = QLineEdit(); self.p1_input.setPlaceholderText("Nhap API key...")
        p1r.addWidget(self.p1_input, 1)
        b = QPushButton("+ Them"); b.setStyleSheet(f"background:{GREEN}; color:white; font-weight:bold;")
        b.clicked.connect(lambda: self._add_key("provider1")); p1r.addWidget(b)
        g1_lay.addLayout(p1r); lay.addWidget(g1)

        # Provider 2
        g2 = QGroupBox("Provider 2 — PiAPI")
        g2_lay = QVBoxLayout(g2)
        self.p2_total = QLabel("Tong: ...")
        self.p2_total.setStyleSheet(f"color:{GREEN}; font-weight:bold; font-size:12px;")
        g2_lay.addWidget(self.p2_total)
        self.p2_table = QTableWidget(0, 5)
        self.p2_table.setHorizontalHeaderLabels(["#", "API Key", "So du (USD)", "Runtime", ""])
        self.p2_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.p2_table.setColumnWidth(0, 30); self.p2_table.setColumnWidth(2, 120); self.p2_table.setColumnWidth(3, 150); self.p2_table.setColumnWidth(4, 60)
        g2_lay.addWidget(self.p2_table)
        p2r = QHBoxLayout()
        self.p2_input = QLineEdit(); self.p2_input.setPlaceholderText("Nhap API key...")
        p2r.addWidget(self.p2_input, 1)
        b2 = QPushButton("+ Them"); b2.setStyleSheet(f"background:{GREEN}; color:white; font-weight:bold;")
        b2.clicked.connect(lambda: self._add_key("provider2")); p2r.addWidget(b2)
        g2_lay.addLayout(p2r); lay.addWidget(g2)

        # Buttons
        br = QHBoxLayout()
        rb = QPushButton("Kiem tra so du"); rb.setStyleSheet(f"background:{YELLOW}; color:#2d1a0e; font-weight:bold; font-size:12px; padding:8px;")
        rb.clicked.connect(self._check_all_credits); br.addWidget(rb)
        sb = QPushButton("Luu & Push GitHub"); sb.setStyleSheet(f"background:{ORANGE}; color:white; font-weight:bold; font-size:12px; padding:8px;")
        sb.clicked.connect(self._save_keys); br.addWidget(sb)
        eb = QPushButton("Xuat Excel"); eb.setStyleSheet(f"background:{CARD}; color:{TEXT}; border:1px solid {BORDER}; font-weight:bold; font-size:12px; padding:8px;")
        eb.clicked.connect(self._export_keys_excel); br.addWidget(eb)
        lay.addLayout(br)
        self._load_keys(); self._refresh_runtime_key_status(); self._check_all_credits()

    def _load_keys(self):
        data = {"provider1": [], "provider2": []}
        try:
            if os.path.exists(KEYS_FILE):
                with open(KEYS_FILE, "r") as f:
                    raw = json.load(f)
                data["provider1"] = raw.get("provider1") or raw.get("keys") or []
                data["provider2"] = raw.get("provider2") or []
        except Exception: pass
        self._fill_key_table(self.p1_table, data["provider1"])
        self._fill_key_table(self.p2_table, data["provider2"])

    def _fill_key_table(self, table, keys):
        table.setRowCount(len(keys))
        for i, k in enumerate(keys):
            table.setItem(i, 0, QTableWidgetItem(str(i+1)))
            table.setItem(i, 1, QTableWidgetItem(k))
            cr = QTableWidgetItem("..."); cr.setForeground(QColor(MUTED)); cr.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            table.setItem(i, 2, cr)
            rt = QTableWidgetItem("Chua doi soat"); rt.setForeground(QColor(MUTED)); rt.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            table.setItem(i, 3, rt)
            d = QPushButton("Xoa"); d.setStyleSheet(f"background:{RED}; color:white; font-size:9px; padding:2px 6px;")
            d.clicked.connect(lambda _, t=table, btn=d: self._del_key_button(t, btn)); table.setCellWidget(i, 4, d)

    def _refresh_runtime_key_status(self):
        for table in (self.p1_table, self.p2_table):
            for i in range(table.rowCount()):
                item = table.item(i, 3)
                if item is None:
                    item = QTableWidgetItem("Chua doi soat")
                    item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                    table.setItem(i, 3, item)
                item.setText("Dang doi soat...")
                item.setForeground(QColor(YELLOW))
        try:
            res = requests.get(f"{BACKEND_API_BASE}/api/providers/runtime-keys/status", timeout=5)
            res.raise_for_status()
            payload = res.json() or {}
            p1_hashes = set((payload.get("provider1") or {}).get("loaded_hashes") or [])
            p2_hashes = set((payload.get("provider2") or {}).get("loaded_hashes") or [])
        except Exception as e:
            for table in (self.p1_table, self.p2_table):
                for i in range(table.rowCount()):
                    item = table.item(i, 3)
                    if item:
                        item.setText("Chua nap")
                        item.setForeground(QColor(RED))
            self._monitor_log("Monitor Runtime Key Check Failed", str(e))
            return
        self._apply_runtime_status(self.p1_table, p1_hashes)
        self._apply_runtime_status(self.p2_table, p2_hashes)
        self._monitor_log("Monitor Runtime Key Check", f"P1={len(p1_hashes)} | P2={len(p2_hashes)}")

    def _apply_runtime_status(self, table, loaded_hashes):
        for i in range(table.rowCount()):
            key_item = table.item(i, 1)
            status_item = table.item(i, 3)
            if not key_item or not status_item:
                continue
            digest = hashlib.sha256(key_item.text().strip().encode("utf-8")).hexdigest()
            if digest in loaded_hashes:
                status_item.setText("Da nap vao runtime")
                status_item.setForeground(QColor(GREEN))
            else:
                status_item.setText("Chua nap")
                status_item.setForeground(QColor(RED))

    def _collect_keys(self, table):
        return [
            table.item(i, 1).text().strip()
            for i in range(table.rowCount())
            if table.item(i, 1) and table.item(i, 1).text().strip()
        ]

    def _persist_keys_local(self):
        p1 = self._collect_keys(self.p1_table)
        p2 = self._collect_keys(self.p2_table)
        payload = {"provider1": p1, "provider2": p2}
        tmp_path = f"{KEYS_FILE}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, KEYS_FILE)
        with open(KEYS_FILE, "r", encoding="utf-8") as f:
            saved = json.load(f)
        if saved != payload:
            raise RuntimeError("Persisted API key data does not match requested payload")

    def _renumber_key_table(self, table):
        for i in range(table.rowCount()):
            table.setItem(i, 0, QTableWidgetItem(str(i + 1)))

    def _find_button_row(self, table, button):
        for row in range(table.rowCount()):
            if table.cellWidget(row, 4) is button:
                return row
        return -1

    def _del_key_button(self, table, button):
        row = self._find_button_row(table, button)
        if row >= 0:
            self._del_key_row(table, row)

    def _add_key(self, provider):
        inp = self.p1_input if provider == "provider1" else self.p2_input
        table = self.p1_table if provider == "provider1" else self.p2_table
        key = inp.text().strip()
        if not key:
            return
        existing = self._collect_keys(table)
        if key in existing:
            QMessageBox.warning(self, "Loi", "Key da ton tai")
            return
        row = table.rowCount(); table.setRowCount(row+1)
        table.setItem(row, 0, QTableWidgetItem(str(row+1)))
        table.setItem(row, 1, QTableWidgetItem(key))
        cr = QTableWidgetItem("Dang kiem tra..."); cr.setForeground(QColor(YELLOW)); cr.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        table.setItem(row, 2, cr)
        rt = QTableWidgetItem("Dang doi soat..."); rt.setForeground(QColor(YELLOW)); rt.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        table.setItem(row, 3, rt)
        d = QPushButton("Xoa"); d.setStyleSheet(f"background:{RED}; color:white; font-size:9px; padding:2px 6px;")
        d.clicked.connect(lambda _, t=table, btn=d: self._del_key_button(t, btn)); table.setCellWidget(row, 4, d)
        inp.clear()
        try:
            self._persist_keys_local()
        except Exception as e:
            self._monitor_log("Monitor Key Add Failed", f"{provider} | {e}", 0, provider)
            QMessageBox.warning(self, "Loi", str(e))
            return
        self._load_keys()
        self._refresh_runtime_key_status()
        self._monitor_log("Monitor Key Add", f"{provider} | ...{key[-6:]}", 0, provider)
        w = CreditChecker(provider, [key])
        w.result.connect(self._on_credit_result)
        w.finished.connect(self._on_check_done)
        w.start()
        self._workers.append(w)

    def _del_key_row(self, table, row):
        if row >= table.rowCount():
            return
        table.removeRow(row)
        self._renumber_key_table(table)
        try:
            self._persist_keys_local()
        except Exception as e:
            self._monitor_log("Monitor Key Delete Failed", str(e), 0, "monitor")
            QMessageBox.warning(self, "Loi", str(e))
            return
        self._load_keys()
        self._refresh_runtime_key_status()
        self._monitor_log("Monitor Key Delete", f"row={row+1}", 0, "monitor")
        self._check_all_credits()

    def _check_all_credits(self):
        self.total_lbl.setText("Dang kiem tra...")
        self.p1_total.setText("Tong P1: 0.0 credits")
        self.p2_total.setText("Tong P2: $0.0000 USD")
        self._credit_cache = {}
        self._monitor_log("Monitor Credit Check", "refresh all credits", 0, "monitor")
        p1k = self._collect_keys(self.p1_table)
        p2k = self._collect_keys(self.p2_table)
        if not p1k and not p2k:
            self.total_lbl.setText("P1: 0 cr | P2: $0.0000")
            return
        for provider, keys in [("provider1", p1k), ("provider2", p2k)]:
            if keys:
                w = CreditChecker(provider, keys); w.result.connect(self._on_credit_result)
                w.finished.connect(self._on_check_done); w.start(); self._workers.append(w)

    def _on_credit_result(self, provider, key, credits):
        table = self.p1_table if provider == "provider1" else self.p2_table
        unit = "cr" if provider == "provider1" else "USD"
        for i in range(table.rowCount()):
            if table.item(i,1) and table.item(i,1).text() == key:
                cr = table.item(i,2)
                if credits < 0: cr.setText("Loi"); cr.setForeground(QColor(RED))
                elif credits == 0: cr.setText(f"0 {unit}"); cr.setForeground(QColor(RED))
                else: cr.setText(f"{credits:,.1f} {unit}"); cr.setForeground(QColor(GREEN))
                self._credit_cache[key] = credits; break
        # Update provider totals
        if provider == "provider1":
            t = sum(max(0, self._credit_cache.get(self.p1_table.item(i,1).text(), 0)) for i in range(self.p1_table.rowCount()) if self.p1_table.item(i,1))
            self.p1_total.setText(f"Tong P1: {t:,.1f} credits")
        else:
            t = sum(max(0, self._credit_cache.get(self.p2_table.item(i,1).text(), 0)) for i in range(self.p2_table.rowCount()) if self.p2_table.item(i,1))
            self.p2_total.setText(f"Tong P2: ${t:,.4f} USD")

    def _on_check_done(self):
        p1 = sum(max(0, v) for k, v in self._credit_cache.items() if any(self.p1_table.item(i,1) and self.p1_table.item(i,1).text() == k for i in range(self.p1_table.rowCount())))
        p2 = sum(max(0, v) for k, v in self._credit_cache.items() if any(self.p2_table.item(i,1) and self.p2_table.item(i,1).text() == k for i in range(self.p2_table.rowCount())))
        self.total_lbl.setText(f"P1: {p1:,.0f} cr | P2: ${p2:,.4f}")

    def _save_keys(self):
        p1 = self._collect_keys(self.p1_table)
        p2 = self._collect_keys(self.p2_table)
        try:
            with open(KEYS_FILE, "w", encoding="utf-8") as f: json.dump({"provider1": p1, "provider2": p2}, f, indent=2)
            self._refresh_runtime_key_status()
            os.system(f'cd /d "{os.path.join(BASE)}" && git add data/api_keys.json && git commit -m "Update API keys" && git push origin master')
            self._monitor_log("Monitor Keys Save", f"P1={len(p1)} | P2={len(p2)}", 0, "monitor")
            QMessageBox.information(self, "OK", f"Da luu {len(p1)} P1 + {len(p2)} P2 keys\nDa push len GitHub!")
        except Exception as e: QMessageBox.warning(self, "Loi", str(e))

    def _export_keys_excel(self):
        from PyQt6.QtWidgets import QFileDialog
        path, _ = QFileDialog.getSaveFileName(self, "Xuat API Keys", f"API_Keys_{datetime.datetime.now().strftime('%Y%m%d')}.csv", "CSV (*.csv)")
        if not path: return
        try:
            with open(path, 'w', newline='', encoding='utf-8-sig') as f:
                w = csv.writer(f)
                w.writerow(['Provider', '#', 'API Key', 'So du'])
                for i in range(self.p1_table.rowCount()):
                    key = self.p1_table.item(i, 1).text() if self.p1_table.item(i, 1) else ''
                    cr = self.p1_table.item(i, 2).text() if self.p1_table.item(i, 2) else ''
                    w.writerow(['Provider 1 (KIE)', i+1, key, cr])
                for i in range(self.p2_table.rowCount()):
                    key = self.p2_table.item(i, 1).text() if self.p2_table.item(i, 1) else ''
                    cr = self.p2_table.item(i, 2).text() if self.p2_table.item(i, 2) else ''
                    w.writerow(['Provider 2 (PiAPI)', i+1, key, cr])
            os.startfile(path)
            self._monitor_log("Monitor Keys Export", os.path.basename(path), 0, "monitor")
            QMessageBox.information(self, "OK", f"Da xuat: {os.path.basename(path)}")
        except Exception as e: QMessageBox.warning(self, "Loi", str(e))

    # ══════════════════════════════════════
    # TAB 2: BILLING / PAYMENT HISTORY
    # ══════════════════════════════════════
    def _build_billing_tab(self, parent):
        lay = QVBoxLayout(parent); lay.setSpacing(8)

        # Summary
        sum_row = QHBoxLayout()
        self.billing_summary = QLabel("Tong chi: dang tinh...")
        self.billing_summary.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        self.billing_summary.setStyleSheet(f"color: {ORANGE};")
        sum_row.addWidget(self.billing_summary)
        sum_row.addStretch()
        add_btn = QPushButton("+ Them giao dich")
        add_btn.setStyleSheet(f"background:{GREEN}; color:white; font-weight:bold; font-size:12px; padding:8px 16px;")
        add_btn.clicked.connect(self._add_billing)
        sum_row.addWidget(add_btn)
        lay.addLayout(sum_row)

        # Table
        self.billing_table = QTableWidget(0, 7)
        self.billing_table.setHorizontalHeaderLabels([
            "Ngay", "Provider", "So tien (VND)", "Credits/USD nhan", "Nguoi nap", "Ghi chu", "Xoa"
        ])
        self.billing_table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeMode.Stretch)
        self.billing_table.setColumnWidth(0, 100)
        self.billing_table.setColumnWidth(1, 80)
        self.billing_table.setColumnWidth(2, 110)
        self.billing_table.setColumnWidth(3, 110)
        self.billing_table.setColumnWidth(4, 90)
        self.billing_table.setColumnWidth(6, 50)
        lay.addWidget(self.billing_table)

        # Buttons
        btn_row = QHBoxLayout()
        save_btn = QPushButton("Luu & Push len GitHub")
        save_btn.setStyleSheet(f"background:{ORANGE}; color:white; font-weight:bold; font-size:12px; padding:8px;")
        save_btn.clicked.connect(self._save_billing)
        btn_row.addWidget(save_btn)
        exp_btn = QPushButton("Xuat Excel")
        exp_btn.setStyleSheet(f"background:{CARD}; color:{TEXT}; border:1px solid {BORDER}; font-weight:bold; font-size:12px; padding:8px;")
        exp_btn.clicked.connect(self._export_billing_excel)
        btn_row.addWidget(exp_btn)
        lay.addLayout(btn_row)

        self._load_billing()

    def _load_billing(self):
        self._billing_data = []
        try:
            if os.path.exists(BILLING_FILE):
                with open(BILLING_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._billing_data = data.get("payments", [])
        except Exception: pass
        self._render_billing()

    def _render_billing(self):
        rows = self._billing_data
        self.billing_table.setRowCount(len(rows))
        total_vnd = 0

        for i, p in enumerate(reversed(rows)):  # newest first
            idx = len(rows) - 1 - i
            self.billing_table.setItem(i, 0, QTableWidgetItem(p.get("date", "")))

            prov = p.get("provider", "")
            prov_item = QTableWidgetItem(prov)
            prov_item.setForeground(QColor(ORANGE if "1" in prov else YELLOW))
            self.billing_table.setItem(i, 1, prov_item)

            amount = p.get("amount_vnd", 0)
            total_vnd += amount
            amt_item = QTableWidgetItem(f"{amount:,.0f}")
            amt_item.setForeground(QColor(RED))
            amt_item.setTextAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            self.billing_table.setItem(i, 2, amt_item)

            credits_received = p.get("credits_received", "")
            cr_item = QTableWidgetItem(str(credits_received))
            cr_item.setForeground(QColor(GREEN))
            cr_item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            self.billing_table.setItem(i, 3, cr_item)

            self.billing_table.setItem(i, 4, QTableWidgetItem(p.get("paid_by", "")))
            self.billing_table.setItem(i, 5, QTableWidgetItem(p.get("note", "")))

            d = QPushButton("X")
            d.setStyleSheet(f"background:{RED}; color:white; font-size:9px; padding:2px 4px;")
            d.clicked.connect(lambda _, r=idx: self._del_billing(r))
            self.billing_table.setCellWidget(i, 6, d)

        self.billing_summary.setText(f"Tong chi: {total_vnd:,.0f} VND  |  {len(rows)} giao dich")

    def _add_billing(self):
        dlg = QDialog(self)
        dlg.setWindowTitle("Them giao dich nap tien")
        dlg.setMinimumWidth(400)
        dlg.setStyleSheet(GLOBAL_SS)

        form = QFormLayout(dlg)

        date_edit = QDateEdit(QDate.currentDate())
        date_edit.setCalendarPopup(True)
        date_edit.setDisplayFormat("dd/MM/yyyy")
        form.addRow("Ngay:", date_edit)

        provider_combo = QComboBox()
        provider_combo.addItems(["Provider 1 (KIE)", "Provider 2 (PiAPI)"])
        form.addRow("Provider:", provider_combo)

        amount_input = QLineEdit()
        amount_input.setPlaceholderText("VD: 500000")
        form.addRow("So tien (VND):", amount_input)

        credits_input = QLineEdit()
        credits_input.setPlaceholderText("VD: 150 credits hoac $5.00")
        form.addRow("Credits/USD nhan:", credits_input)

        paid_by = QLineEdit()
        paid_by.setPlaceholderText("VD: Admin")
        form.addRow("Nguoi nap:", paid_by)

        note = QTextEdit()
        note.setMaximumHeight(60)
        note.setPlaceholderText("Ghi chu (tuy chon)...")
        form.addRow("Ghi chu:", note)

        btns = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        btns.accepted.connect(dlg.accept)
        btns.rejected.connect(dlg.reject)
        form.addRow(btns)

        if dlg.exec() == QDialog.DialogCode.Accepted:
            try:
                amt = int(amount_input.text().strip().replace(",", "").replace(".", ""))
            except:
                amt = 0
            entry = {
                "id": str(uuid.uuid4())[:8],
                "date": date_edit.date().toString("dd/MM/yyyy"),
                "provider": provider_combo.currentText(),
                "amount_vnd": amt,
                "credits_received": credits_input.text().strip(),
                "paid_by": paid_by.text().strip() or "Admin",
                "note": note.toPlainText().strip(),
                "created_at": datetime.datetime.now().isoformat(),
            }
            self._billing_data.append(entry)
            self._render_billing()
            self._monitor_log("Monitor Billing Add", f"{entry['provider']} | {amt}", 0, "billing")

    def _del_billing(self, idx):
        if 0 <= idx < len(self._billing_data):
            reply = QMessageBox.question(self, "Xac nhan", "Xoa giao dich nay?",
                                         QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
            if reply == QMessageBox.StandardButton.Yes:
                self._billing_data.pop(idx)
                self._render_billing()
                self._monitor_log("Monitor Billing Delete", f"idx={idx}", 0, "billing")

    def _save_billing(self):
        try:
            with open(BILLING_FILE, "w", encoding="utf-8") as f:
                json.dump({"payments": self._billing_data}, f, indent=2, ensure_ascii=False)
            os.system(f'cd /d "{BASE}" && git add data/billing_history.json && git commit -m "Update billing history" && git push origin master')
            self._monitor_log("Monitor Billing Save", f"rows={len(self._billing_data)}", 0, "billing")
            QMessageBox.information(self, "OK", "Da luu lich su nap tien va push len GitHub!")
        except Exception as e:
            QMessageBox.warning(self, "Loi", str(e))

    def _export_billing_excel(self):
        from PyQt6.QtWidgets import QFileDialog
        path, _ = QFileDialog.getSaveFileName(self, "Xuat Lich su nap tien",
            f"Billing_{datetime.datetime.now().strftime('%Y%m%d')}.csv", "CSV (*.csv)")
        if not path: return
        try:
            with open(path, 'w', newline='', encoding='utf-8-sig') as f:
                w = csv.writer(f)
                w.writerow(['Ngay', 'Provider', 'So tien (VND)', 'Credits/USD nhan', 'Nguoi nap', 'Ghi chu'])
                for p in self._billing_data:
                    w.writerow([p.get('date',''), p.get('provider',''),
                               p.get('amount_vnd',0), p.get('credits_received',''),
                               p.get('paid_by',''), p.get('note','')])
            os.startfile(path)
            self._monitor_log("Monitor Billing Export", os.path.basename(path), 0, "billing")
            QMessageBox.information(self, "OK", f"Da xuat: {os.path.basename(path)}")
        except Exception as e:
            QMessageBox.warning(self, "Loi", str(e))
            self._monitor_log("Monitor Logs Export Failed", str(e))

    # ══════════════════════════════════════
    # TAB 3: USER + ROLE MANAGEMENT
    # ══════════════════════════════════════
    def _load_roles(self):
        """Load role definitions from roles_config.json"""
        default = [
            {"id": "staff", "name": "Staff", "description": "Tao video/anh, xem lich su ca nhan", "permissions": ["create_video", "create_image", "view_own_history", "view_library"]},
            {"id": "qc_manager", "name": "QC Manager", "description": "Duyet/tu choi san pham, xem tat ca staff", "permissions": ["create_video", "create_image", "view_own_history", "view_library", "qc_approve", "qc_reject", "view_all_history", "view_dashboard"]},
            {"id": "admin", "name": "Admin", "description": "Full quyen: quan ly user, key, billing, he thong", "permissions": ["create_video", "create_image", "view_own_history", "view_library", "qc_approve", "qc_reject", "view_all_history", "view_dashboard", "manage_users", "manage_keys", "manage_settings", "view_billing"]},
        ]
        try:
            if os.path.exists(ROLES_FILE):
                with open(ROLES_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return data.get("roles", default)
        except Exception:
            pass
        return default

    def _save_roles(self, roles):
        try:
            with open(ROLES_FILE, "w", encoding="utf-8") as f:
                json.dump({"roles": roles}, f, indent=2, ensure_ascii=False)
        except Exception as e:
            QMessageBox.warning(self, "Loi", str(e))

    def _get_role_ids(self):
        return [r["id"] for r in self._roles]

    def _normalize_role_id(self, role_id):
        role = str(role_id or "staff").strip().lower().replace("-", "_").replace(" ", "_")
        aliases = {
            "qc": "qc_manager",
            "qcmanager": "qc_manager",
            "quality_control": "qc_manager",
            "quality_controller": "qc_manager",
            "administrator": "admin",
        }
        if role in self._get_role_ids():
            return role
        return aliases.get(role, role or "staff")

    def _get_role_display(self, role_id):
        for r in self._roles:
            if r["id"] == role_id:
                return f'{r["name"]}'
        return role_id

    def _build_user_tab(self, parent):
        lay = QVBoxLayout(parent); lay.setSpacing(8)
        self._roles = self._load_roles()

        # ── Role legend ──
        role_grp = QGroupBox("Cac Role trong he thong")
        role_lay = QVBoxLayout(role_grp)

        self.role_legend_layout = role_lay
        self._render_role_legend()

        # Buttons for role management
        role_btns = QHBoxLayout()
        add_role_btn = QPushButton("+ Them Role")
        add_role_btn.setStyleSheet(f"background:{GREEN}; color:white; font-weight:bold;")
        add_role_btn.clicked.connect(self._add_role)
        role_btns.addWidget(add_role_btn)

        save_roles_btn = QPushButton("Luu Roles & Push GitHub")
        save_roles_btn.setStyleSheet(f"background:{ORANGE}; color:white; font-weight:bold;")
        save_roles_btn.clicked.connect(self._save_roles_to_github)
        role_btns.addWidget(save_roles_btn)
        role_btns.addStretch()
        role_lay.addLayout(role_btns)
        lay.addWidget(role_grp)

        login_sec_grp = QGroupBox("Bao mat dang nhap")
        sec_lay = QVBoxLayout(login_sec_grp)
        self.login_2fa_toggle = QCheckBox("Bat phe duyet dang nhap 2FA qua Admin/Telegram")
        self.login_2fa_toggle.setStyleSheet(f"color:{TEXT}; font-weight:bold;")
        sec_lay.addWidget(self.login_2fa_toggle)
        sec_hint = QLabel("Tat: staff vao thang, khong tao pending login va khong day qua Telegram.")
        sec_hint.setWordWrap(True)
        sec_hint.setStyleSheet(f"color:{MUTED}; font-size:10px;")
        sec_lay.addWidget(sec_hint)
        sec_btn_row = QHBoxLayout()
        sec_save_btn = QPushButton("Luu cai dat 2FA")
        sec_save_btn.setStyleSheet(f"background:{ORANGE}; color:white; font-weight:bold;")
        sec_save_btn.clicked.connect(self._save_login_security_settings)
        sec_btn_row.addWidget(sec_save_btn)
        sec_reload_btn = QPushButton("Tai lai")
        sec_reload_btn.clicked.connect(self._load_login_security_settings)
        sec_btn_row.addWidget(sec_reload_btn)
        sec_btn_row.addStretch()
        sec_lay.addLayout(sec_btn_row)
        lay.addWidget(login_sec_grp)
        login_sec_grp.hide()

        # ── User table ──
        self.user_table = QTableWidget(0, 9)
        self.user_table.setHorizontalHeaderLabels(["#", "Username", "Ten hien thi", "Mat khau", "Role", "Doi Role", "2FA", "Trang thai", "Xoa"])
        self.user_table.setColumnWidth(0, 25)
        self.user_table.setColumnWidth(1, 100)
        self.user_table.setColumnWidth(2, 100)
        self.user_table.setColumnWidth(3, 100)
        self.user_table.setColumnWidth(4, 80)
        self.user_table.setColumnWidth(5, 110)
        self.user_table.setColumnWidth(6, 60)
        self.user_table.setColumnWidth(7, 60)
        self.user_table.setColumnWidth(8, 50)
        lay.addWidget(self.user_table)

        # ── Add user form ──
        add_grp = QGroupBox("Them User Moi")
        al = QHBoxLayout(add_grp); al.setSpacing(6)
        al.addWidget(QLabel("Username:"))
        self.new_username = QLineEdit(); self.new_username.setPlaceholderText("staff_03"); al.addWidget(self.new_username)
        al.addWidget(QLabel("Ten:"))
        self.new_display = QLineEdit(); self.new_display.setPlaceholderText("Staff 03"); al.addWidget(self.new_display)
        al.addWidget(QLabel("MK:"))
        self.new_password = QLineEdit(); self.new_password.setPlaceholderText("Staff@2025"); al.addWidget(self.new_password)
        al.addWidget(QLabel("Role:"))
        self.new_role = QComboBox()
        for r in self._roles:
            self.new_role.addItem(f'{r["name"]} — {r["description"][:30]}', r["id"])
        al.addWidget(self.new_role)
        self.new_login_2fa = QCheckBox("2FA")
        self.new_login_2fa.setChecked(False)
        self.new_login_2fa.setToolTip("Bat de user nay phai phe duyet dang nhap.")
        al.addWidget(self.new_login_2fa)
        ab = QPushButton("+ Them"); ab.setStyleSheet(f"background:{GREEN}; color:white; font-weight:bold;")
        ab.clicked.connect(self._add_user); al.addWidget(ab)
        lay.addWidget(add_grp)

        # Export button
        exp_row = QHBoxLayout()
        
        self.btn_toggle_pw = QPushButton("Hiện Mật Khẩu (Show)")
        self.btn_toggle_pw.setStyleSheet(f"background:{CARD}; color:{TEXT}; border:1px solid {BORDER}; font-weight:bold; font-size:11px; padding:6px 16px;")
        self.btn_toggle_pw.setCheckable(True)
        self.btn_toggle_pw.clicked.connect(self._toggle_passwords)
        exp_row.addWidget(self.btn_toggle_pw)
        
        exp_row.addStretch()
        exp_btn = QPushButton("Xuat Excel")
        exp_btn.setStyleSheet(f"background:{CARD}; color:{TEXT}; border:1px solid {BORDER}; font-weight:bold; font-size:11px; padding:6px 16px;")
        exp_btn.clicked.connect(self._export_users_excel)
        exp_row.addWidget(exp_btn)
        lay.addLayout(exp_row)

        self._load_users()
        # Double-click password cell to reset
        self.user_table.cellDoubleClicked.connect(self._on_user_table_dblclick)

    def _on_user_table_dblclick(self, row, col):
        if col == 3:  # Password column
            un_item = self.user_table.item(row, 1)
            if un_item:
                username = un_item.text()
                # Find user id
                try:
                    conn = self._get_db()
                    r = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
                    conn.close()
                    if r:
                        self._reset_password(r["id"], username)
                        self._load_users()
                except Exception: pass

    def _render_role_legend(self):
        # Clear old items (except the last layout which is buttons)
        while self.role_legend_layout.count() > 0:
            item = self.role_legend_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
            elif item.layout():
                # Clear sublayout
                while item.layout().count() > 0:
                    sub = item.layout().takeAt(0)
                    if sub.widget(): sub.widget().deleteLater()

        for r in self._roles:
            row = QHBoxLayout()
            # Role name
            name_lbl = QLabel(f'  {r["name"]}')
            name_lbl.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
            color = GREEN if r["id"] == "admin" else (YELLOW if r["id"] == "qc_manager" else ORANGE)
            name_lbl.setStyleSheet(f"color:{color}; min-width:90px;")
            row.addWidget(name_lbl)

            # Description
            desc_lbl = QLabel(r.get("description", ""))
            desc_lbl.setStyleSheet(f"color:{TEXT};")
            row.addWidget(desc_lbl, 1)

            # Permissions count
            perms = r.get("permissions", [])
            perm_lbl = QLabel(f'{len(perms)} quyen')
            perm_lbl.setStyleSheet(f"color:{MUTED}; font-size:10px;")
            row.addWidget(perm_lbl)

            # Delete role button (not for default roles)
            if r["id"] not in ("staff", "admin"):
                del_btn = QPushButton("X")
                del_btn.setFixedSize(22, 22)
                del_btn.setStyleSheet(f"background:{RED}; color:white; font-size:9px; border-radius:11px; padding:0;")
                del_btn.clicked.connect(lambda _, rid=r["id"]: self._del_role(rid))
                row.addWidget(del_btn)

            container = QWidget()
            container.setLayout(row)
            self.role_legend_layout.addWidget(container)

    def _add_role(self):
        dlg = QDialog(self)
        dlg.setWindowTitle("Them Role Moi")
        dlg.setMinimumWidth(450)
        dlg.setStyleSheet(GLOBAL_SS)
        form = QFormLayout(dlg)

        id_input = QLineEdit()
        id_input.setPlaceholderText("vd: supervisor (khong dau, khong khoang trang)")
        form.addRow("Role ID:", id_input)

        name_input = QLineEdit()
        name_input.setPlaceholderText("vd: Supervisor")
        form.addRow("Ten hien thi:", name_input)

        desc_input = QLineEdit()
        desc_input.setPlaceholderText("vd: Giam sat va phe duyet cong viec")
        form.addRow("Mo ta:", desc_input)

        # Permission checkboxes
        all_perms = [
            ("create_video", "Tao video"),
            ("create_image", "Tao/sua anh"),
            ("view_own_history", "Xem lich su ca nhan"),
            ("view_library", "Xem thu vien"),
            ("qc_approve", "Duyet san pham (QC)"),
            ("qc_reject", "Tu choi san pham (QC)"),
            ("view_all_history", "Xem lich su tat ca staff"),
            ("view_dashboard", "Xem dashboard tong quan"),
            ("manage_users", "Quan ly user"),
            ("manage_keys", "Quan ly API keys"),
            ("manage_settings", "Cau hinh he thong"),
            ("view_billing", "Xem lich su nap tien"),
        ]
        from PyQt6.QtWidgets import QCheckBox
        perm_checks = {}
        perm_grp = QGroupBox("Quyen:")
        perm_lay = QVBoxLayout(perm_grp)
        for pid, plabel in all_perms:
            cb = QCheckBox(f"{plabel} ({pid})")
            # Default: check basic ones
            if pid in ("create_video", "create_image", "view_own_history", "view_library"):
                cb.setChecked(True)
            perm_checks[pid] = cb
            perm_lay.addWidget(cb)
        form.addRow(perm_grp)

        btns = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        btns.accepted.connect(dlg.accept); btns.rejected.connect(dlg.reject)
        form.addRow(btns)

        if dlg.exec() == QDialog.DialogCode.Accepted:
            rid = id_input.text().strip().lower().replace(" ", "_")
            rname = name_input.text().strip()
            rdesc = desc_input.text().strip()
            if not rid or not rname:
                QMessageBox.warning(self, "Loi", "Nhap Role ID va Ten!"); return
            if rid in self._get_role_ids():
                QMessageBox.warning(self, "Loi", f"Role '{rid}' da ton tai!"); return
            perms = [pid for pid, cb in perm_checks.items() if cb.isChecked()]
            self._roles.append({"id": rid, "name": rname, "description": rdesc, "permissions": perms})
            self._render_role_legend()
            # Update combo in add user form
            self.new_role.clear()
            for r in self._roles:
                self.new_role.addItem(f'{r["name"]} — {r["description"][:30]}', r["id"])
            self._monitor_log("Monitor Role Add", f"{rid} | {rname}")

    def _del_role(self, role_id):
        if QMessageBox.question(self, "Xac nhan", f"Xoa role '{role_id}'?",
                                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No) != QMessageBox.StandardButton.Yes:
            return
        self._roles = [r for r in self._roles if r["id"] != role_id]
        self._render_role_legend()
        self.new_role.clear()
        for r in self._roles:
            self.new_role.addItem(f'{r["name"]} — {r["description"][:30]}', r["id"])
        self._monitor_log("Monitor Role Delete", role_id)

    def _save_roles_to_github(self):
        self._save_roles(self._roles)
        os.system(f'cd /d "{BASE}" && git add backend/roles_config.json && git commit -m "Update roles config" && git push origin master')
        QMessageBox.information(self, "OK", "Da luu roles va push len GitHub!")
        self._monitor_log("Monitor Roles Push", f"{len(self._roles)} roles")

    def _get_db(self):
        sys.path.insert(0, os.path.join(BASE, "backend"))
        import database
        database.init_db()
        return database.get_conn()

    def _load_system_settings(self):
        data = {"login_2fa_enabled": True}
        try:
            if os.path.exists(SYSTEM_SETTINGS_FILE):
                with open(SYSTEM_SETTINGS_FILE, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                if isinstance(raw, dict):
                    data.update(raw)
        except Exception:
            pass
        data["login_2fa_enabled"] = bool(data.get("login_2fa_enabled", True))
        return data

    def _save_system_settings(self, data):
        merged = self._load_system_settings()
        merged.update(dict(data or {}))
        merged["login_2fa_enabled"] = bool(merged.get("login_2fa_enabled", True))
        with open(SYSTEM_SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=2, ensure_ascii=False)
        return merged

    def _load_login_security_settings(self):
        try:
            settings = self._load_system_settings()
            if getattr(self, "login_2fa_toggle", None):
                self.login_2fa_toggle.setChecked(bool(settings.get("login_2fa_enabled", True)))
        except Exception as e:
            QMessageBox.warning(self, "Loi", f"Khong tai duoc cai dat 2FA: {e}")

    def _save_login_security_settings(self):
        try:
            enabled = bool(self.login_2fa_toggle.isChecked()) if getattr(self, "login_2fa_toggle", None) else True
            self._save_system_settings({"login_2fa_enabled": enabled})
            QMessageBox.information(
                self,
                "OK",
                "Da luu cai dat 2FA dang nhap.\nBat: can admin/telebot phe duyet.\nTat: vao thang, khong day Telegram.",
            )
            self._monitor_log("Monitor Login 2FA Save", f"enabled={int(enabled)}")
        except Exception as e:
            QMessageBox.warning(self, "Loi", f"Khong luu duoc cai dat 2FA: {e}")
            self._monitor_log("Monitor Login 2FA Save Failed", str(e))

    def _load_pw_cache(self):
        try:
            if os.path.exists(PASSWORDS_FILE):
                with open(PASSWORDS_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception: pass
        return {}

    def _save_pw_cache(self, data):
        try:
            with open(PASSWORDS_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception: pass

    def _toggle_passwords(self, checked):
        self.btn_toggle_pw.setText("Ẩn Mật Khẩu (Hide)" if checked else "Hiện Mật Khẩu (Show)")
        self._load_users()

    def _load_users(self):
        try:
            conn = self._get_db()
            rows = conn.execute(
                "SELECT id, username, display_name, role, login_2fa_enabled, active FROM users ORDER BY created_at"
            ).fetchall()
            conn.close()
        except Exception as e:
            QMessageBox.warning(self, "Loi", str(e)); return

        pw_cache = self._load_pw_cache()
        self.user_table.setRowCount(len(rows))
        for i, row in enumerate(rows):
            uid, un = row["id"], row["username"]
            self.user_table.setItem(i, 0, QTableWidgetItem(str(i + 1)))
            self.user_table.setItem(i, 1, QTableWidgetItem(un))
            self.user_table.setItem(i, 2, QTableWidgetItem(row["display_name"]))

            # Password
            pw = pw_cache.get(un, "***")
            if not getattr(self, 'btn_toggle_pw', None) or not self.btn_toggle_pw.isChecked():
                pw = "***"
            pw_item = QTableWidgetItem(pw)
            pw_item.setForeground(QColor(MUTED))
            self.user_table.setItem(i, 3, pw_item)

            # Role with color
            role = row["role"]
            role_item = QTableWidgetItem(self._get_role_display(role))
            color = GREEN if role == "admin" else (YELLOW if role == "qc_manager" else ORANGE)
            role_item.setForeground(QColor(color))
            role_item.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
            self.user_table.setItem(i, 4, role_item)

            # Role change combo
            combo = QComboBox()
            for r in self._roles:
                combo.addItem(r["name"], r["id"])
            for ci in range(combo.count()):
                if combo.itemData(ci) == role:
                    combo.setCurrentIndex(ci); break
            combo.currentIndexChanged.connect(lambda _, u=uid, c=combo: self._change_user_role(u, c.currentData()))
            self.user_table.setCellWidget(i, 5, combo)

            if role == "admin":
                no_toggle = QTableWidgetItem("-")
                no_toggle.setForeground(QColor(MUTED))
                no_toggle.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                self.user_table.setItem(i, 6, no_toggle)
            else:
                toggle = QCheckBox()
                toggle.setChecked(bool(row["login_2fa_enabled"]))
                toggle.setStyleSheet(f"margin-left:16px; margin-right:16px;")
                toggle.toggled.connect(lambda checked, u=uid: self._set_user_login_2fa(u, checked))
                self.user_table.setCellWidget(i, 6, toggle)

            # Status
            active = row["active"]
            si = QTableWidgetItem("Active" if active else "Off")
            si.setForeground(QColor(GREEN if active else RED))
            self.user_table.setItem(i, 7, si)

            # Delete (not admin)
            if un != "admin":
                db = QPushButton("Xoa"); db.setStyleSheet(f"background:{RED}; color:white; font-size:9px; padding:2px 6px;")
                db.clicked.connect(lambda _, u=uid, n=un: self._delete_user(u, n))
                self.user_table.setCellWidget(i, 8, db)

    def _export_users_excel(self):
        from PyQt6.QtWidgets import QFileDialog
        path, _ = QFileDialog.getSaveFileName(self, "Xuat User List",
            f"Users_{datetime.datetime.now().strftime('%Y%m%d')}.csv", "CSV (*.csv)")
        if not path: return
        try:
            pw_cache = self._load_pw_cache()
            conn = self._get_db()
            rows = conn.execute(
                "SELECT username, display_name, role, login_2fa_enabled, active FROM users ORDER BY created_at"
            ).fetchall()
            conn.close()
            with open(path, 'w', newline='', encoding='utf-8-sig') as f:
                w = csv.writer(f)
                w.writerow(['#', 'Username', 'Ten hien thi', 'Mat khau', 'Role', '2FA Login', 'Trang thai'])
                for i, r in enumerate(rows):
                    role_name = self._get_role_display(r["role"])
                    login_2fa = "On" if r["login_2fa_enabled"] else "Off"
                    status = "Active" if r["active"] else "Off"
                    pw = pw_cache.get(r["username"], "***")
                    w.writerow([i+1, r["username"], r["display_name"], pw, role_name, login_2fa, status])
            os.startfile(path)
            QMessageBox.information(self, "OK", f"Da xuat: {os.path.basename(path)}")
            self._monitor_log("Monitor Users Export", os.path.basename(path))
        except Exception as e:
            QMessageBox.warning(self, "Loi", str(e))
            self._monitor_log("Monitor Users Export Failed", str(e))

    def _change_user_role(self, uid, new_role):
        try:
            new_role = self._normalize_role_id(new_role)
            conn = self._get_db()
            user_row = conn.execute("SELECT username, role FROM users WHERE id=?", (uid,)).fetchone()
            if new_role == "admin":
                conn.execute("UPDATE users SET role=?, login_2fa_enabled=0 WHERE id=?", (new_role, uid))
            else:
                conn.execute("UPDATE users SET role=? WHERE id=?", (new_role, uid))
            conn.commit(); conn.close()
            self._load_users()
            if user_row:
                self._monitor_log("Monitor User Role Change", f'{user_row["username"]}: {user_row["role"]} -> {new_role}')
        except Exception as e:
            QMessageBox.warning(self, "Loi", str(e))
            self._monitor_log("Monitor User Role Change Failed", str(e))

    def _set_user_login_2fa(self, uid, enabled):
        try:
            conn = self._get_db()
            user_row = conn.execute("SELECT username, role FROM users WHERE id=?", (uid,)).fetchone()
            if user_row and self._normalize_role_id(user_row["role"]) == "admin":
                conn.close()
                self._load_users()
                return
            conn.execute("UPDATE users SET login_2fa_enabled=? WHERE id=?", (1 if enabled else 0, uid))
            if not enabled:
                conn.execute(
                    "UPDATE pending_logins SET status='replaced' WHERE user_id=? AND status='pending'",
                    (uid,),
                )
            conn.commit(); conn.close()
            self._load_users()
            if user_row:
                self._monitor_log("Monitor User Login 2FA", f'{user_row["username"]}: {int(enabled)}')
        except Exception as e:
            QMessageBox.warning(self, "Loi", f"Khong doi duoc 2FA cho user: {e}")
            self._load_users()
            self._monitor_log("Monitor User Login 2FA Failed", str(e))

    def _add_user(self):
        un = self.new_username.text().strip(); dn = self.new_display.text().strip()
        pw = self.new_password.text().strip(); role = self._normalize_role_id(self.new_role.currentData() or "staff")
        login_2fa_enabled = 1 if getattr(self, "new_login_2fa", None) and self.new_login_2fa.isChecked() else 0
        if role == "admin":
            login_2fa_enabled = 0
        if not un or not pw: QMessageBox.warning(self, "Loi", "Nhap username va mat khau!"); return
        if not dn: dn = un
        try:
            conn = self._get_db()
            if conn.execute("SELECT 1 FROM users WHERE username=?", (un,)).fetchone():
                QMessageBox.warning(self, "Loi", f"'{un}' da ton tai!"); conn.close(); return
            ph = bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
            conn.execute(
                "INSERT INTO users (id,username,password_hash,display_name,role,login_2fa_enabled,active,created_at) VALUES (?,?,?,?,?,?,?,?)",
                (str(uuid.uuid4()), un, ph, dn, role, login_2fa_enabled, 1, time.time()),
            )
            conn.commit(); conn.close()
            # Save password to cache
            pc = self._load_pw_cache(); pc[un] = pw; self._save_pw_cache(pc)
            self.new_username.clear(); self.new_display.clear(); self.new_password.clear()
            if getattr(self, "new_login_2fa", None):
                self.new_login_2fa.setChecked(False)
            self._load_users()
            QMessageBox.information(self, "OK", f"Da them: {un} ({role})")
            self._monitor_log("Monitor User Add", f"{un} | {role}")
        except Exception as e:
            QMessageBox.warning(self, "Loi", str(e))
            self._monitor_log("Monitor User Add Failed", str(e))

    def _reset_password(self, uid, username):
        pw, ok = QInputDialog.getText(self, "Reset MK", f"Mat khau moi cho '{username}':")
        if not ok or not pw.strip(): return
        try:
            conn = self._get_db()
            ph = bcrypt.hashpw(pw.strip().encode(), bcrypt.gensalt()).decode()
            conn.execute("UPDATE users SET password_hash=? WHERE id=?", (ph, uid))
            conn.commit(); conn.close()
            # Update password cache
            pc = self._load_pw_cache(); pc[username] = pw.strip(); self._save_pw_cache(pc)
            QMessageBox.information(self, "OK", f"Da reset MK cho '{username}'")
            self._monitor_log("Monitor User Password Reset", username)
        except Exception as e:
            QMessageBox.warning(self, "Loi", str(e))
            self._monitor_log("Monitor User Password Reset Failed", str(e))

    def _delete_user(self, uid, username):
        if QMessageBox.question(self, "Xac nhan", f"Xoa '{username}'?",
                                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No) != QMessageBox.StandardButton.Yes: return
        try:
            conn = self._get_db(); conn.execute("DELETE FROM users WHERE id=?", (uid,))
            conn.commit(); conn.close(); self._load_users()
            QMessageBox.information(self, "OK", f"Da xoa '{username}'")
            self._monitor_log("Monitor User Delete", username)
        except Exception as e:
            QMessageBox.warning(self, "Loi", str(e))
            self._monitor_log("Monitor User Delete Failed", str(e))

    # ══════════════════════════════════════
    # TAB 4: ACTIVITY LOGS
    # ══════════════════════════════════════
    def _build_logs_tab(self, parent):
        lay = QVBoxLayout(parent); lay.setSpacing(8)

        runtime_box = QGroupBox("Dieu hanh standalone")
        runtime_lay = QVBoxLayout(runtime_box)
        runtime_lay.setSpacing(8)

        runtime_cards = QHBoxLayout()
        runtime_cards.setSpacing(8)
        self.runtime_open_tasks_lbl = QLabel("Ca dang mo\n--")
        self.runtime_pending_login_lbl = QLabel("Login cho duyet\n--")
        self.runtime_pending_qc_lbl = QLabel("QC cho duyet\n--")
        self.runtime_pending_video_lbl = QLabel("Video queue\n--")
        self.runtime_pending_image_lbl = QLabel("Image queue\n--")
        for widget in (
            self.runtime_open_tasks_lbl,
            self.runtime_pending_login_lbl,
            self.runtime_pending_qc_lbl,
            self.runtime_pending_video_lbl,
            self.runtime_pending_image_lbl,
        ):
            widget.setMinimumHeight(58)
            widget.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
            widget.setStyleSheet(
                f"background:{BG}; color:{TEXT}; border:1px solid {BORDER};"
                f" border-radius:6px; padding:8px; font-size:11px; font-weight:bold;"
            )
            runtime_cards.addWidget(widget, 1)
        runtime_lay.addLayout(runtime_cards)

        self.runtime_table = QTableWidget(0, 6)
        self.runtime_table.setHorizontalHeaderLabels(["User", "Role", "Ca dang mo", "Bat dau", "Video", "Lan cuoi"])
        self.runtime_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        self.runtime_table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeMode.Stretch)
        self.runtime_table.setColumnWidth(0, 120)
        self.runtime_table.setColumnWidth(1, 90)
        self.runtime_table.setColumnWidth(3, 130)
        self.runtime_table.setColumnWidth(4, 60)
        runtime_lay.addWidget(self.runtime_table)
        lay.addWidget(runtime_box)

        # Summary
        self.logs_summary = QLabel("Dang tai...")
        self.logs_summary.setStyleSheet(f"color:{GREEN}; font-weight:bold; font-size:12px;")
        lay.addWidget(self.logs_summary)

        # Filters row
        filt = QHBoxLayout(); filt.setSpacing(6)
        filt.addWidget(QLabel("User:"))
        self.logs_user_filter = QComboBox()
        self.logs_user_filter.addItem("Tat ca", "")
        self.logs_user_filter.setMinimumWidth(120)
        self.logs_user_filter.currentIndexChanged.connect(self._render_logs)
        filt.addWidget(self.logs_user_filter)

        filt.addWidget(QLabel("Ngay:"))
        self.logs_date_filter = QComboBox()
        self.logs_date_filter.addItem("Tat ca", "")
        self.logs_date_filter.setMinimumWidth(100)
        self.logs_date_filter.currentIndexChanged.connect(self._render_logs)
        filt.addWidget(self.logs_date_filter)

        filt.addWidget(QLabel("Nhom:"))
        self.logs_group_filter = QComboBox()
        self.logs_group_filter.addItem("Tat ca", "")
        self.logs_group_filter.setMinimumWidth(130)
        self.logs_group_filter.currentIndexChanged.connect(self._render_logs)
        filt.addWidget(self.logs_group_filter)

        self.logs_hide_noise_chk = QCheckBox("An heartbeat/status")
        self.logs_hide_noise_chk.setChecked(False)
        self.logs_hide_noise_chk.stateChanged.connect(self._render_logs)
        filt.addWidget(self.logs_hide_noise_chk)

        filt.addStretch()
        ref_btn = QPushButton("Lam moi")
        ref_btn.setStyleSheet(f"background:{YELLOW}; color:#2d1a0e; font-weight:bold; padding:6px 12px;")
        ref_btn.clicked.connect(self._load_logs)
        filt.addWidget(ref_btn)
        lay.addLayout(filt)

        # Table
        self.logs_table = QTableWidget(0, 6)
        self.logs_table.setHorizontalHeaderLabels(["Thoi gian", "User", "Tac vu", "Chi tiet", "Credits", "Provider"])
        self.logs_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        self.logs_table.setColumnWidth(0, 130)
        self.logs_table.setColumnWidth(1, 80)
        self.logs_table.setColumnWidth(2, 90)
        self.logs_table.setColumnWidth(4, 60)
        self.logs_table.setColumnWidth(5, 80)
        lay.addWidget(self.logs_table)

        # Buttons
        btn_row = QHBoxLayout()
        exp_btn = QPushButton("Xuat Excel")
        exp_btn.setStyleSheet(f"background:{CARD}; color:{TEXT}; border:1px solid {BORDER}; font-weight:bold; font-size:12px; padding:8px;")
        exp_btn.clicked.connect(self._export_logs_excel)
        btn_row.addWidget(exp_btn)
        save_btn = QPushButton("Luu & Push GitHub")
        save_btn.setStyleSheet(f"background:{ORANGE}; color:white; font-weight:bold; font-size:12px; padding:8px;")
        save_btn.clicked.connect(self._save_logs_github)
        btn_row.addWidget(save_btn)
        clear_btn = QPushButton("Xoa tat ca logs")
        clear_btn.setStyleSheet(f"background:{RED}; color:white; font-weight:bold; font-size:12px; padding:8px;")
        clear_btn.clicked.connect(self._clear_logs)
        btn_row.addWidget(clear_btn)
        lay.addLayout(btn_row)

        self._logs_data = []
        self._load_logs()

    def _load_logs(self):
        self._load_runtime_snapshot()
        try:
            conn = self._get_db()
            cur = conn.cursor()
            # Ensure table exists even if backend hasn't started yet
            try:
                cur.execute("""CREATE TABLE IF NOT EXISTS activity_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT, user_name TEXT, action TEXT,
                    detail TEXT DEFAULT '', credits REAL DEFAULT 0,
                    provider TEXT DEFAULT ''
                )""")
                conn.commit()
            except Exception:
                pass
            cur.execute("SELECT user_name, action, detail, credits, provider, timestamp FROM activity_logs ORDER BY timestamp DESC LIMIT 2000")
            rows = cur.fetchall()
            qc_rows = cur.execute(
                "SELECT id, task_id, user_display, status, reviewer, reject_reason, submitted_at, reviewed_at FROM qc_queue ORDER BY submitted_at DESC LIMIT 500"
            ).fetchall()
            conn.close()
            
            self._logs_data = []
            for r in rows:
                self._logs_data.append({
                    "user": r[0] or "",
                    "action": r[1] or "",
                    "detail": r[2] or "",
                    "credits": r[3] or 0,
                    "provider": r[4] or "",
                    "timestamp": str(r[5])[:19] if r[5] else ""
                })
            existing = {
                (
                    str(item.get("timestamp") or ""),
                    str(item.get("user") or ""),
                    str(item.get("action") or ""),
                    str(item.get("detail") or ""),
                )
                for item in self._logs_data
            }
            for row in qc_rows:
                qc_id, task_id, user_display, status, reviewer, reject_reason, submitted_at, reviewed_at = row
                submit_ts = ""
                try:
                    submit_ts = datetime.datetime.fromtimestamp(float(submitted_at or 0)).strftime("%Y-%m-%d %H:%M:%S")
                except Exception:
                    submit_ts = ""
                submit_entry = (submit_ts, str(user_display or ""), "QC Submit", str(task_id or ""))
                if all(submit_entry) and submit_entry not in existing:
                    self._logs_data.append({
                        "user": user_display or "",
                        "action": "QC Submit",
                        "detail": task_id or "",
                        "credits": 0,
                        "provider": "qc_queue",
                        "timestamp": submit_ts,
                    })
                    existing.add(submit_entry)
                status_text = str(status or "").lower()
                if status_text in {"approved", "rejected"}:
                    review_ts = ""
                    try:
                        review_ts = datetime.datetime.fromtimestamp(float(reviewed_at or 0)).strftime("%Y-%m-%d %H:%M:%S")
                    except Exception:
                        review_ts = ""
                    action = "QC Approve" if status_text == "approved" else "QC Reject"
                    detail = str(task_id or "")
                    if status_text == "rejected" and reject_reason:
                        detail = f"{detail} | {reject_reason}"
                    review_user = reviewer or user_display or ""
                    review_entry = (review_ts, str(review_user), action, detail)
                    if all(review_entry[:3]) and review_entry not in existing:
                        self._logs_data.append({
                            "user": review_user,
                            "action": action,
                            "detail": detail,
                            "credits": 0,
                            "provider": "qc_queue",
                            "timestamp": review_ts,
                        })
                        existing.add(review_entry)
        except Exception as e:
            print(f"Supabase fetching error: {e}")
            self._logs_data = []

        # Populate user filter
        self.logs_user_filter.blockSignals(True)
        current = self.logs_user_filter.currentData()
        self.logs_user_filter.clear()
        self.logs_user_filter.addItem("Tat ca", "")
        users = sorted(set(l.get("user", "") for l in self._logs_data))
        for u in users:
            if u: self.logs_user_filter.addItem(u, u)
        # Restore
        for i in range(self.logs_user_filter.count()):
            if self.logs_user_filter.itemData(i) == current:
                self.logs_user_filter.setCurrentIndex(i); break
        self.logs_user_filter.blockSignals(False)

        # Populate date filter
        self.logs_date_filter.blockSignals(True)
        self.logs_date_filter.clear()
        self.logs_date_filter.addItem("Tat ca", "")
        dates = sorted(set(l.get("timestamp", "")[:10] for l in self._logs_data), reverse=True)
        for d in dates:
            if d: self.logs_date_filter.addItem(d, d)
        self.logs_date_filter.blockSignals(False)

        self.logs_group_filter.blockSignals(True)
        current_group = self.logs_group_filter.currentData() if hasattr(self, "logs_group_filter") else ""
        self.logs_group_filter.clear()
        self.logs_group_filter.addItem("Tat ca", "")
        groups = sorted(set(self._log_group_label(l.get("action", ""), l.get("detail", "")) for l in self._logs_data))
        for g in groups:
            if g:
                self.logs_group_filter.addItem(g, g)
        for i in range(self.logs_group_filter.count()):
            if self.logs_group_filter.itemData(i) == current_group:
                self.logs_group_filter.setCurrentIndex(i); break
        self.logs_group_filter.blockSignals(False)

        self._render_logs()

    def _load_runtime_snapshot(self):
        try:
            conn = self._get_db()
            active_rows = conn.execute(
                "SELECT user_name, user_display, title, created_at, video_count, credits_used, status FROM work_tasks WHERE status='active' ORDER BY created_at DESC"
            ).fetchall()
            role_rows = conn.execute(
                "SELECT username, role FROM users"
            ).fetchall()
            pending_login_count = conn.execute(
                "SELECT COUNT(*) FROM pending_logins WHERE status='pending'"
            ).fetchone()[0]
            pending_qc_count = conn.execute(
                "SELECT COUNT(*) FROM qc_queue WHERE status='pending'"
            ).fetchone()[0]
            pending_video_count = conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE status='pending' AND gen_mode IN ('img2vid','frames','txt2vid')"
            ).fetchone()[0]
            pending_image_count = conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE status='pending' AND gen_mode='image_edit'"
            ).fetchone()[0]
            recent_logs = conn.execute(
                "SELECT user_name, action, detail, timestamp FROM activity_logs ORDER BY timestamp DESC LIMIT 500"
            ).fetchall()
            conn.close()
        except Exception as e:
            self.runtime_open_tasks_lbl.setText("Ca dang mo\nERR")
            self.runtime_pending_login_lbl.setText("Login cho duyet\nERR")
            self.runtime_pending_qc_lbl.setText("QC cho duyet\nERR")
            self.runtime_pending_video_lbl.setText("Video queue\nERR")
            self.runtime_pending_image_lbl.setText("Image queue\nERR")
            self.runtime_table.setRowCount(0)
            self.logs_summary.setText(f"Khong tai duoc runtime snapshot: {e}")
            return

        self.runtime_open_tasks_lbl.setText(f"Ca dang mo\n{len(active_rows)}")
        self.runtime_pending_login_lbl.setText(f"Login cho duyet\n{pending_login_count}")
        self.runtime_pending_qc_lbl.setText(f"QC cho duyet\n{pending_qc_count}")
        self.runtime_pending_video_lbl.setText(f"Video queue\n{pending_video_count}")
        self.runtime_pending_image_lbl.setText(f"Image queue\n{pending_image_count}")

        last_activity = {}
        for row in recent_logs:
            user_name = row[0] or ""
            if user_name and user_name not in last_activity:
                detail = row[2] or ""
                action = row[1] or ""
                last_activity[user_name] = f"{action}: {detail}".strip(": ")

        role_map = {row["username"]: self._normalize_role_id(row["role"]) for row in role_rows}

        self.runtime_table.setRowCount(len(active_rows))
        for i, row in enumerate(active_rows):
            user_name = row["user_name"] or ""
            user_display = row["user_display"] or user_name
            title = row["title"] or ""
            created_at = row["created_at"] or 0
            video_count = row["video_count"] or 0
            started = "--"
            try:
                started = datetime.datetime.fromtimestamp(float(created_at)).strftime("%Y-%m-%d %H:%M")
            except Exception:
                pass

            role_text = role_map.get(user_name, "staff")
            latest = last_activity.get(user_name, "--")

            self.runtime_table.setItem(i, 0, QTableWidgetItem(user_display))
            self.runtime_table.setItem(i, 1, QTableWidgetItem(self._get_role_display(role_text)))
            self.runtime_table.setItem(i, 2, QTableWidgetItem(title))
            self.runtime_table.setItem(i, 3, QTableWidgetItem(started))
            self.runtime_table.setItem(i, 4, QTableWidgetItem(str(video_count)))
            self.runtime_table.setItem(i, 5, QTableWidgetItem(latest))


    def _render_logs(self):
        user_f = self.logs_user_filter.currentData() or ""
        date_f = self.logs_date_filter.currentData() or ""
        group_f = self.logs_group_filter.currentData() or ""

        filtered = self._logs_data
        if user_f:
            filtered = [l for l in filtered if l.get("user") == user_f]
        if date_f:
            filtered = [l for l in filtered if l.get("timestamp", "").startswith(date_f)]
        if group_f:
            filtered = [l for l in filtered if self._log_group_label(l.get("action", ""), l.get("detail", "")) == group_f]

        # Calculate online time
        online_seconds = 0
        from datetime import datetime
        login_times = {}
        chrono_logs = sorted(filtered, key=lambda x: x.get("timestamp", ""))
        for l in chrono_logs:
            u = l.get("user")
            act = l.get("action", "")
            try:
                t = datetime.strptime(l.get("timestamp", ""), "%Y-%m-%d %H:%M:%S")
            except Exception: continue
            
            if act == "Login":
                login_times[u] = t
            elif act in ["Logout", "Thoát App"] and u in login_times:
                online_seconds += (t - login_times[u]).total_seconds()
                del login_times[u]
        
        # Add ongoing sessions for today
        now = datetime.now()
        for u, t in login_times.items():
            if t.date() == now.date():
                online_seconds += (now - t).total_seconds()
                
        hours = int(online_seconds // 3600)
        minutes = int((online_seconds % 3600) // 60)
        time_str = f"{hours}h {minutes}m"

        # Sort newest first for table display
        filtered = sorted(filtered, key=lambda x: x.get("timestamp", ""), reverse=True)

        total_cr = sum(l.get("credits", 0) for l in filtered)
        self.logs_summary.setText(f"Tổng: {len(filtered)} tác vụ  |  Credits tiêu thụ: {total_cr}  |  Tổng Online: {time_str}")

        self.logs_table.setRowCount(len(filtered))
        for i, l in enumerate(filtered):
            self.logs_table.setItem(i, 0, QTableWidgetItem(l.get("timestamp", "")))
            self.logs_table.setItem(i, 1, QTableWidgetItem(l.get("user", "")))

            action = l.get("action", "")
            action_text = event_label(action, l.get("detail", ""))
            ai = QTableWidgetItem(action_text)
            act_lower = action_text.lower()
            if "video" in act_lower:
                ai.setForeground(QColor(ORANGE))
                ai.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
            elif "image" in act_lower:
                ai.setForeground(QColor(GREEN))
                ai.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
            elif "login" in act_lower or "đăng nhập" in act_lower:
                ai.setForeground(QColor("#4CAF50"))
            elif "logout" in act_lower or "thoát" in act_lower:
                ai.setForeground(QColor("#F44336"))
            elif "crash" in act_lower or "error" in act_lower:
                ai.setForeground(QColor(RED))
                ai.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
            else:
                ai.setForeground(QColor(YELLOW))
            self.logs_table.setItem(i, 2, ai)

            self.logs_table.setItem(i, 3, QTableWidgetItem(l.get("detail", "")))

            cr = l.get("credits", 0)
            ci = QTableWidgetItem(str(cr))
            ci.setForeground(QColor(ORANGE if cr > 0 else MUTED))
            ci.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
            self.logs_table.setItem(i, 4, ci)

            self.logs_table.setItem(i, 5, QTableWidgetItem(l.get("provider", "")))

    def _log_group_label(self, action: str, detail: str = "") -> str:
        return event_group(action, detail)

    def _is_noisy_log_row(self, row: dict) -> bool:
        event_type = normalize_event(row.get("action", ""), row.get("detail", ""))
        detail = str(row.get("detail", "") or "")
        if event_type != "api_http":
            return False
        return any(token in detail for token in (
            "/api/system/heartbeat",
            "/api/system/status",
            "/api/notifications",
            "/api/auth/poll/",
            "/api/credits/refresh",
            "/api/credits/balance",
        ))

    def _format_log_detail(self, row: dict) -> str:
        detail = str(row.get("detail", "") or "").strip()
        event_type = normalize_event(row.get("action", ""), detail)
        provider = str(row.get("provider", "") or "").strip()
        if event_type == "api_http":
            return detail
        if event_type.startswith("batch_"):
            return f"Batch | {detail}"
        if event_type.startswith("video_"):
            return f"Tao video | {detail}"
        if event_type.startswith("image_"):
            return f"Chinh sua anh | {detail}"
        if event_type.startswith("qc_"):
            return f"QC | {detail}"
        if event_type in {"ai_chat", "ai_analyze"}:
            return f"AI Agent | {detail}"
        if event_type.startswith("telegram_"):
            return f"Telegram | {detail}"
        if event_type.startswith("monitor_"):
            return f"Monitor | {detail}"
        if event_type in {"task_start", "task_close", "shift_report"}:
            return f"Task/Ca | {detail}"
        if provider and provider not in {"", event_type}:
            return f"{provider} | {detail}"
        return detail

    def _export_logs_excel(self):
        from PyQt6.QtWidgets import QFileDialog
        path, _ = QFileDialog.getSaveFileName(self, "Xuat Logs",
            f"Activity_Logs_{datetime.datetime.now().strftime('%Y%m%d')}.csv", "CSV (*.csv)")
        if not path: return
        try:
            with open(path, 'w', newline='', encoding='utf-8-sig') as f:
                w = csv.writer(f)
                w.writerow(['Thoi gian', 'User', 'Tac vu', 'Chi tiet', 'Credits', 'Provider'])
                for l in sorted(self._logs_data, key=lambda x: x.get("timestamp",""), reverse=True):
                    w.writerow([l.get('timestamp',''), l.get('user',''), l.get('action',''),
                               l.get('detail',''), l.get('credits',0), l.get('provider','')])
            os.startfile(path)
            QMessageBox.information(self, "OK", f"Da xuat: {os.path.basename(path)}")
        except Exception as e: QMessageBox.warning(self, "Loi", str(e))

    def _save_logs_github(self):
        try:
            with open(LOGS_FILE, "w", encoding="utf-8") as f:
                json.dump({"logs": self._logs_data}, f, indent=2, ensure_ascii=False)
            os.system(f'cd /d "{BASE}" && git add data/activity_logs.json && git commit -m "Update activity logs" && git push origin master')
            QMessageBox.information(self, "OK", "Da push logs len GitHub!")
            self._monitor_log("Monitor Logs Push", f"{len(self._logs_data)} rows")
        except Exception as e: QMessageBox.warning(self, "Loi", str(e))

    def _clear_logs(self):
        if QMessageBox.question(self, "Xac nhan", "Xoa tat ca logs tren Cloud?",
                                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No) != QMessageBox.StandardButton.Yes:
            return
        deleted_count = len(self._logs_data)
        self._logs_data = []
        try:
            conn = self._get_db()
            conn.execute("DELETE FROM activity_logs")
            conn.commit()
            conn.close()
            self._render_logs()
            self._monitor_log("Monitor Logs Clear", f"{deleted_count} rows")
        except Exception as e: QMessageBox.warning(self, "Loi DB", str(e))

    def _render_logs(self):
        user_f = self.logs_user_filter.currentData() or ""
        date_f = self.logs_date_filter.currentData() or ""
        group_f = self.logs_group_filter.currentData() or ""

        hide_noise = bool(getattr(self, "logs_hide_noise_chk", None) and self.logs_hide_noise_chk.isChecked())
        filtered = [l for l in self._logs_data if (not hide_noise or not self._is_noisy_log_row(l))]
        if user_f:
            filtered = [l for l in filtered if l.get("user") == user_f]
        if date_f:
            filtered = [l for l in filtered if l.get("timestamp", "").startswith(date_f)]
        if group_f:
            filtered = [l for l in filtered if self._log_group_label(l.get("action", ""), l.get("detail", "")) == group_f]

        online_seconds = 0
        from datetime import datetime
        login_times = {}
        chrono_logs = sorted(filtered, key=lambda x: x.get("timestamp", ""))
        for row in chrono_logs:
            user_name = row.get("user")
            action = row.get("action", "")
            try:
                logged_at = datetime.strptime(row.get("timestamp", ""), "%Y-%m-%d %H:%M:%S")
            except Exception:
                continue
            event_type = normalize_event(action, row.get("detail", ""))
            if event_type == "login":
                login_times[user_name] = logged_at
            elif event_type == "logout" and user_name in login_times:
                online_seconds += (logged_at - login_times[user_name]).total_seconds()
                del login_times[user_name]

        now = datetime.now()
        for _, logged_at in login_times.items():
            if logged_at.date() == now.date():
                online_seconds += (now - logged_at).total_seconds()

        hours = int(online_seconds // 3600)
        minutes = int((online_seconds % 3600) // 60)
        time_str = f"{hours}h {minutes}m"

        filtered = sorted(filtered, key=lambda x: x.get("timestamp", ""), reverse=True)
        total_cr = sum(row.get("credits", 0) for row in filtered)
        self.logs_summary.setText(f"Tong: {len(filtered)} tac vu  |  Credits: {total_cr}  |  Online: {time_str}")

        self.logs_table.setRowCount(len(filtered))
        for i, row in enumerate(filtered):
            self.logs_table.setItem(i, 0, QTableWidgetItem(row.get("timestamp", "")))
            self.logs_table.setItem(i, 1, QTableWidgetItem(row.get("user", "")))

            action = row.get("action", "")
            detail = row.get("detail", "")
            action_text = event_label(action, detail)
            event_type = normalize_event(action, detail)
            action_item = QTableWidgetItem(action_text)
            if event_type.startswith("video_"):
                action_item.setForeground(QColor(ORANGE))
                action_item.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
            elif event_type.startswith("image_"):
                action_item.setForeground(QColor(GREEN))
                action_item.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
            elif event_type == "login":
                action_item.setForeground(QColor("#4CAF50"))
            elif event_type == "logout":
                action_item.setForeground(QColor("#F44336"))
            elif "error" in action_text.lower() or "fail" in action_text.lower():
                action_item.setForeground(QColor(RED))
                action_item.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
            else:
                action_item.setForeground(QColor(YELLOW))
            self.logs_table.setItem(i, 2, action_item)
            self.logs_table.setItem(i, 3, QTableWidgetItem(self._format_log_detail(row)))

            credits = row.get("credits", 0)
            credit_item = QTableWidgetItem(str(credits))
            credit_item.setForeground(QColor(ORANGE if credits > 0 else MUTED))
            credit_item.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
            self.logs_table.setItem(i, 4, credit_item)
            self.logs_table.setItem(i, 5, QTableWidgetItem(row.get("provider", "")))

    def _export_logs_excel(self):
        from PyQt6.QtWidgets import QFileDialog
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Xuat Logs",
            f"Activity_Logs_{datetime.datetime.now().strftime('%Y%m%d')}.csv",
            "CSV (*.csv)",
        )
        if not path:
            return
        try:
            with open(path, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.writer(f)
                writer.writerow(["Thoi gian", "User", "Tac vu", "Chi tiet", "Credits", "Provider"])
                for row in sorted(self._logs_data, key=lambda x: x.get("timestamp", ""), reverse=True):
                    writer.writerow([
                        row.get("timestamp", ""),
                        row.get("user", ""),
                        event_label(row.get("action", ""), row.get("detail", "")),
                        row.get("detail", ""),
                        row.get("credits", 0),
                        row.get("provider", ""),
                    ])
            os.startfile(path)
            QMessageBox.information(self, "OK", f"Da xuat: {os.path.basename(path)}")
            self._monitor_log("Monitor Logs Export", os.path.basename(path))
        except Exception as e:
            QMessageBox.warning(self, "Loi", str(e))
            self._monitor_log("Monitor Logs Export Failed", str(e))


def log_activity(user: str, action: str, detail: str = "", credits: int = 0, provider: str = ""):
    """Utility function — log an activity directly to Cloud DB."""
    try:
        import sys, os, datetime
        base_dir = os.path.dirname(os.path.abspath(__file__))
        sys.path.insert(0, os.path.join(base_dir, "backend"))
        import database
        conn = database.get_conn()
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            "INSERT INTO activity_logs (timestamp, user_name, action, detail, credits, provider) VALUES (?, ?, ?, ?, ?, ?)",
            (ts, user, action, detail, float(credits), provider)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Cloud Log Error: {e}")


def log_activity(user: str, action: str, detail: str = "", credits: int = 0, provider: str = ""):
    shared_log_activity(user, action, detail, credits, provider)


if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setFont(QFont("Segoe UI", 10))
    
    pwd, ok = QInputDialog.getText(None, "Security Verification", "Nhập mật khẩu Admin F-Aistudio:", QLineEdit.EchoMode.Password)
    if not ok or pwd != "260795":
        QMessageBox.critical(None, "Truy cập bị từ chối", "Mật khẩu Admin không chính xác!")
        sys.exit(0)
        
    win = AdminMonitor()
    win.show()
    sys.exit(app.exec())
