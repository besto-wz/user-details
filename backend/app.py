# -*- coding: utf-8 -*-
"""司机黑名单收集系统 - Flask 后端
匹配前端 app.js 的全部 /api/* 接口
技术栈: Flask + SQLite + Bearer Token 认证 + CORS
"""
import os
import sqlite3
import secrets
from datetime import datetime
from functools import wraps

from flask import Flask, request, jsonify, g, send_from_directory
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "bos.db")

app = Flask(__name__)
CORS(app)  # 生产可按需收紧为固定前端域名

# ============ 数据库 ============
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M")


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    company TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'operator',
    is_active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS problems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    id_card TEXT NOT NULL,
    phone TEXT DEFAULT '',
    license_no TEXT DEFAULT '',
    issue_desc TEXT DEFAULT '',
    features TEXT DEFAULT '',
    operator_id INTEGER NOT NULL,
    created_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS driver_problems (
    driver_id INTEGER NOT NULL,
    problem_id INTEGER NOT NULL,
    PRIMARY KEY (driver_id, problem_id)
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT ''
);
"""

SEED_USERS = [
    ("admin", "admin123", "系统经理", "", "manager"),
    ("op01", "123456", "西南运营中心", "西南运营中心", "operator"),
    ("op02", "123456", "华东运营中心", "华东运营中心", "operator"),
]

SEED_PROBLEMS = [
    "有诈骗记录",
    "有酒驾记录",
    "重大交通事故",
    "拖欠租金",
    "失联",
    "违规操作",
    "合同违约",
    "有暴力记录",
]


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
    cur = db.cursor()
    cur.execute("SELECT COUNT(*) FROM users")
    if cur.fetchone()[0] == 0:
        for u, p, d, c, r in SEED_USERS:
            cur.execute(
                "INSERT INTO users(username, password_hash, display_name, company, role) VALUES(?,?,?,?,?)",
                (u, generate_password_hash(p), d, c, r),
            )
    cur.execute("SELECT COUNT(*) FROM problems")
    if cur.fetchone()[0] == 0:
        for i, name in enumerate(SEED_PROBLEMS):
            cur.execute(
                "INSERT INTO problems(name, is_active, sort_order) VALUES(?,1,?)",
                (name, i),
            )
    db.commit()
    db.close()


# ============ 认证 ============
def current_user():
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    row = get_db().execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
        (token,),
    ).fetchone()
    return dict(row) if row else None


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        u = current_user()
        if not u:
            return jsonify({"error": "未登录或登录已过期"}), 401
        g.user = u
        return fn(*args, **kwargs)
    return wrapper


def require_manager(fn):
    @wraps(fn)
    @require_auth
    def wrapper(*args, **kwargs):
        if g.user["role"] != "manager":
            return jsonify({"error": "无权限"}), 403
        return fn(*args, **kwargs)
    return wrapper


# ============ 数据组装 ============
def problem_dict_for_driver(driver_id):
    rows = get_db().execute(
        """SELECT p.id, p.name FROM driver_problems dp
           JOIN problems p ON p.id = dp.problem_id
           WHERE dp.driver_id = ? ORDER BY p.sort_order, p.id""",
        (driver_id,),
    ).fetchall()
    return [{"id": r["id"], "name": r["name"]} for r in rows]


def driver_to_dict(row):
    d = dict(row)
    op = get_db().execute(
        "SELECT display_name, company FROM users WHERE id = ?", (d["operator_id"],)
    ).fetchone()
    d["problems"] = problem_dict_for_driver(d["id"])
    d["operator_name"] = op["display_name"] if op else ""
    d["operator_company"] = op["company"] if op else ""
    return d


def user_to_dict(row):
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "company": row["company"],
        "role": row["role"],
        "is_active": bool(row["is_active"]),
    }


# ============ 登录 / 会话 ============
@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return jsonify({"error": "请输入用户名和密码"}), 400

    row = get_db().execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    ).fetchone()
    if not row or not check_password_hash(row["password_hash"], password):
        return jsonify({"error": "用户名或密码错误"}), 401
    if not row["is_active"]:
        return jsonify({"error": "账号已停用"}), 403

    token = secrets.token_hex(32)
    get_db().execute(
        "INSERT INTO sessions(token, user_id, created_at) VALUES(?,?,?)",
        (token, row["id"], now_str()),
    )
    get_db().commit()
    return jsonify({"token": token, "user": user_to_dict(row)})


@app.route("/api/logout", methods=["POST"])
@require_auth
def logout():
    auth = request.headers.get("Authorization", "")[7:]
    get_db().execute("DELETE FROM sessions WHERE token = ?", (auth,))
    get_db().commit()
    return jsonify({"ok": True})


@app.route("/api/me", methods=["GET"])
@require_auth
def me():
    return jsonify({"user": user_to_dict(g.user)})


# ============ 问题字典 ============
@app.route("/api/problems", methods=["GET"])
@require_auth
def problems_list():
    rows = get_db().execute(
        "SELECT id, name, is_active FROM problems WHERE is_active = 1 ORDER BY sort_order, id"
    ).fetchall()
    return jsonify({"problems": [{"id": r["id"], "name": r["name"], "is_active": True} for r in rows]})


@app.route("/api/problems/manage", methods=["GET"])
@require_manager
def problems_manage():
    rows = get_db().execute(
        "SELECT id, name, is_active, sort_order FROM problems ORDER BY sort_order, id"
    ).fetchall()
    return jsonify({"problems": [
        {"id": r["id"], "name": r["name"], "is_active": bool(r["is_active"]), "sort_order": r["sort_order"]}
        for r in rows
    ]})


@app.route("/api/problems", methods=["POST"])
@require_manager
def problems_create():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "请输入问题/特征名称"}), 400
    db = get_db()
    max_order = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM problems").fetchone()[0]
    db.execute("INSERT INTO problems(name, is_active, sort_order) VALUES(?,1,?)", (name, max_order + 1))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/problems/<int:pid>", methods=["PUT"])
@require_manager
def problems_update(pid):
    data = request.get_json(silent=True) or {}
    db = get_db()
    row = db.execute("SELECT * FROM problems WHERE id = ?", (pid,)).fetchone()
    if not row:
        return jsonify({"error": "记录不存在"}), 404
    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"error": "名称不能为空"}), 400
        db.execute("UPDATE problems SET name = ? WHERE id = ?", (name, pid))
    if "is_active" in data:
        db.execute("UPDATE problems SET is_active = ? WHERE id = ?", (1 if data["is_active"] else 0, pid))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/problems/<int:pid>/move", methods=["POST"])
@require_manager
def problems_move(pid):
    direction = request.args.get("dir", "up")
    db = get_db()
    rows = db.execute("SELECT id, sort_order FROM problems ORDER BY sort_order, id").fetchall()
    ids = [r["id"] for r in rows]
    if pid not in ids:
        return jsonify({"error": "记录不存在"}), 404
    idx = ids.index(pid)
    swap = idx - 1 if direction == "up" else idx + 1
    if swap < 0 or swap >= len(ids):
        return jsonify({"ok": True})  # 已到边界
    a = rows[idx]
    b = rows[swap]
    db.execute("UPDATE problems SET sort_order = ? WHERE id = ?", (b["sort_order"], a["id"]))
    db.execute("UPDATE problems SET sort_order = ? WHERE id = ?", (a["sort_order"], b["id"]))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/problems/<int:pid>", methods=["DELETE"])
@require_manager
def problems_delete(pid):
    db = get_db()
    db.execute("DELETE FROM driver_problems WHERE problem_id = ?", (pid,))
    db.execute("DELETE FROM problems WHERE id = ?", (pid,))
    db.commit()
    return jsonify({"ok": True})


# ============ 司机 ============
def _driver_filters(query, allowed_operator_id=None):
    """根据 query 参数拼 WHERE，返回 (where_sql, params)"""
    conds = []
    params = []
    if query.get("name"):
        conds.append("d.name LIKE ?")
        params.append(f"%{query['name']}%")
    if query.get("id_card"):
        conds.append("d.id_card = ?")
        params.append(query["id_card"])
    if query.get("operator_id"):
        conds.append("d.operator_id = ?")
        params.append(query["operator_id"])
    if allowed_operator_id is not None:
        conds.append("d.operator_id = ?")
        params.append(allowed_operator_id)
    where = (" WHERE " + " AND ".join(conds)) if conds else ""
    return where, params


@app.route("/api/drivers", methods=["GET"])
@require_manager
def drivers_all():
    where, params = _driver_filters(request.args, allowed_operator_id=None)
    rows = get_db().execute(
        f"SELECT * FROM drivers d{where} ORDER BY d.id DESC", params
    ).fetchall()
    return jsonify({"drivers": [driver_to_dict(r) for r in rows]})


@app.route("/api/drivers/mine", methods=["GET"])
@require_auth
def drivers_mine():
    where, params = _driver_filters(request.args, allowed_operator_id=g.user["id"])
    rows = get_db().execute(
        f"SELECT * FROM drivers d{where} ORDER BY d.id DESC", params
    ).fetchall()
    return jsonify({"drivers": [driver_to_dict(r) for r in rows]})


@app.route("/api/drivers/query", methods=["GET"])
@require_auth
def drivers_query():
    # 跨运营商查询（放车前核实），不限 operator
    where, params = _driver_filters(request.args, allowed_operator_id=None)
    rows = get_db().execute(
        f"SELECT * FROM drivers d{where} ORDER BY d.id DESC", params
    ).fetchall()
    return jsonify({"drivers": [driver_to_dict(r) for r in rows]})


@app.route("/api/drivers", methods=["POST"])
@require_auth
def drivers_create():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    id_card = (data.get("id_card") or "").strip()
    problem_ids = data.get("problemIds") or []
    if not name:
        return jsonify({"error": "请输入司机姓名"}), 400
    if not id_card:
        return jsonify({"error": "请输入身份证号"}), 400
    if not problem_ids:
        return jsonify({"error": "请至少选择一个问题/特征类型"}), 400

    db = get_db()
    dup = db.execute(
        "SELECT d.*, u.display_name, u.company FROM drivers d JOIN users u ON u.id = d.operator_id WHERE d.id_card = ? LIMIT 1",
        (id_card,),
    ).fetchone()

    cur = db.execute(
        """INSERT INTO drivers(name, id_card, phone, license_no, issue_desc, features, operator_id, created_at)
           VALUES(?,?,?,?,?,?,?,?)""",
        (name, id_card, data.get("phone", "").strip(), data.get("license_no", "").strip(),
         data.get("issue_desc", "").strip(), data.get("features", "").strip(),
         g.user["id"], now_str()),
    )
    did = cur.lastrowid
    for pid in set(int(p) for p in problem_ids):
        db.execute("INSERT OR IGNORE INTO driver_problems(driver_id, problem_id) VALUES(?,?)", (did, pid))
    db.commit()

    resp = {"ok": True}
    if dup:
        resp["duplicate"] = {"name": dup["name"]}
    return jsonify(resp)


@app.route("/api/drivers/<int:did>", methods=["GET"])
@require_auth
def drivers_get(did):
    row = get_db().execute("SELECT * FROM drivers WHERE id = ?", (did,)).fetchone()
    if not row:
        return jsonify({"error": "记录不存在"}), 404
    return jsonify({"driver": driver_to_dict(row)})


@app.route("/api/drivers/<int:did>", methods=["PUT"])
@require_auth
def drivers_update(did):
    row = get_db().execute("SELECT * FROM drivers WHERE id = ?", (did,)).fetchone()
    if not row:
        return jsonify({"error": "记录不存在"}), 404
    if g.user["role"] != "manager" and row["operator_id"] != g.user["id"]:
        return jsonify({"error": "无权限"}), 403

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    id_card = (data.get("id_card") or "").strip()
    problem_ids = data.get("problemIds") or []
    if not name or not id_card or not problem_ids:
        return jsonify({"error": "姓名、身份证号、问题类型均不能为空"}), 400

    db = get_db()
    db.execute(
        """UPDATE drivers SET name=?, id_card=?, phone=?, license_no=?, issue_desc=?, features=?
           WHERE id=?""",
        (name, id_card, data.get("phone", "").strip(), data.get("license_no", "").strip(),
         data.get("issue_desc", "").strip(), data.get("features", "").strip(), did),
    )
    db.execute("DELETE FROM driver_problems WHERE driver_id = ?", (did,))
    for pid in set(int(p) for p in problem_ids):
        db.execute("INSERT OR IGNORE INTO driver_problems(driver_id, problem_id) VALUES(?,?)", (did, pid))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/drivers/<int:did>", methods=["DELETE"])
@require_auth
def drivers_delete(did):
    row = get_db().execute("SELECT * FROM drivers WHERE id = ?", (did,)).fetchone()
    if not row:
        return jsonify({"error": "记录不存在"}), 404
    if g.user["role"] != "manager" and row["operator_id"] != g.user["id"]:
        return jsonify({"error": "无权限"}), 403
    db = get_db()
    db.execute("DELETE FROM driver_problems WHERE driver_id = ?", (did,))
    db.execute("DELETE FROM drivers WHERE id = ?", (did,))
    db.commit()
    return jsonify({"ok": True})


# ============ 用户管理 ============
@app.route("/api/users", methods=["GET"])
@require_manager
def users_list():
    rows = get_db().execute("SELECT * FROM users ORDER BY id").fetchall()
    return jsonify({"users": [user_to_dict(r) for r in rows]})


@app.route("/api/users", methods=["POST"])
@require_manager
def users_create():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    display_name = (data.get("display_name") or "").strip()
    company = (data.get("company") or "").strip()
    role = data.get("role") or "operator"
    if not username or not display_name or not password:
        return jsonify({"error": "用户名、密码、显示名称均不能为空"}), 400
    if role not in ("manager", "operator"):
        role = "operator"
    db = get_db()
    if db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone():
        return jsonify({"error": "用户名已存在"}), 400
    db.execute(
        "INSERT INTO users(username, password_hash, display_name, company, role, is_active) VALUES(?,?,?,?,?,1)",
        (username, generate_password_hash(password), display_name, company, role),
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/users/<int:uid>", methods=["PUT"])
@require_manager
def users_update(uid):
    row = get_db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if not row:
        return jsonify({"error": "账号不存在"}), 404
    data = request.get_json(silent=True) or {}
    db = get_db()
    fields = []
    params = []
    for key in ("display_name", "company", "role"):
        if key in data:
            val = (data.get(key) or "").strip()
            if key == "role" and val not in ("manager", "operator"):
                continue
            fields.append(f"{key} = ?")
            params.append(val)
    if data.get("password"):
        fields.append("password_hash = ?")
        params.append(generate_password_hash(data["password"]))
    if "is_active" in data:
        fields.append("is_active = ?")
        params.append(1 if data["is_active"] else 0)
    if fields:
        params.append(uid)
        db.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", params)
        db.commit()
    return jsonify({"ok": True})


@app.route("/api/users/<int:uid>", methods=["DELETE"])
@require_manager
def users_delete(uid):
    row = get_db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if not row:
        return jsonify({"error": "账号不存在"}), 404
    if row["role"] == "manager":
        return jsonify({"error": "不能删除经理账号"}), 400
    db = get_db()
    driver_ids = [r["id"] for r in db.execute("SELECT id FROM drivers WHERE operator_id = ?", (uid,)).fetchall()]
    for did in driver_ids:
        db.execute("DELETE FROM driver_problems WHERE driver_id = ?", (did,))
    db.execute("DELETE FROM drivers WHERE operator_id = ?", (uid,))
    db.execute("DELETE FROM users WHERE id = ?", (uid,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "service": "司机黑名单收集系统后端"})


# ============ 前端静态文件（一体化部署时同源 serve） ============
@app.route("/index.html")
@app.route("/")
def front_index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/style.css")
def front_style():
    return send_from_directory(BASE_DIR, "style.css")


@app.route("/app.js")
def front_appjs():
    return send_from_directory(BASE_DIR, "app.js")


# 模块加载即初始化数据库（幂等，兼容 gunicorn 启动）
init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
