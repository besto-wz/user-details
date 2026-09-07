# 司机黑名单收集系统 — 部署说明

## 一、项目结构

```
user-details/
├── index.html       前端入口（GitHub Pages 方案用）
├── style.css        前端样式
├── app.js           前端逻辑
└── backend/         ★ 一体化后端（推荐：直接部署这个目录）
    ├── app.py            Flask 后端 + 静态前端托管
    ├── index.html       前端副本（与后端同源）
    ├── style.css
    ├── app.js
    ├── requirements.txt
    ├── Procfile          Render 启动命令
    └── .gitignore
```

`backend/` 目录已经是**自包含的完整应用**：Flask 同时提供 `/api/*` 接口和前端页面，
前端用相对路径 `/api/...` 同源命中后端，**无需再配置 API 地址**。

## 二、为什么之前打不开

前端 `app.js` 所有数据操作都调 `/api/...`，但原仓库只有静态前端、没有后端。
GitHub Pages 只能托管静态文件、跑不了 Flask，所以登录报 `请求失败(405)`。

## 三、部署（推荐：Render，有免费额度）

**一体化部署，只需把 `backend` 目录部署上去即可：**

1. 注册/登录 [render.com](https://render.com)
2. **New → Web Service** → 连接 GitHub 仓库 `besto-wz/user-details`
3. 关键配置：
   - **Root Directory**：填 `backend`
   - **Build Command**：`pip install -r requirements.txt`
   - **Start Command**：`gunicorn app:app --bind 0.0.0.0:$PORT`
4. 点 **Create Web Service**，等 2~5 分钟部署完成
5. 拿到地址（如 `https://your-app.onrender.com`）直接访问，登录即可用

> 若想继续用 GitHub Pages 做前端（前后端分离方案），则：前端仍托管在 Pages，
> 把 `app.js` 里的 `const API_BASE = ''` 改成后端地址 `https://your-app.onrender.com` 即可。

## 四、测试账号（后端首次启动自动初始化）

| 账号 | 密码 | 角色 |
|---|---|---|
| admin | admin123 | 系统经理（全部功能） |
| op01 | 123456 | 运营商（西南运营中心） |
| op02 | 123456 | 运营商（华东运营中心） |

## 五、注意事项

1. **数据持久化**：Render 免费版磁盘是临时的，服务重启/重新部署后 SQLite 数据会重置（自动重建表 + 初始账号）。正式上线请迁移到 Render 托管 PostgreSQL，或定期备份
2. **CORS**：后端已全局开启 `flask_cors`，一体化同源部署无需跨域；前后端分离时建议收紧为 `CORS(app, origins=["你的前端域名"])`
3. **安全**：上线前务必修改默认密码，删除登录页里的"测试账号"提示
4. **冷启动**：Render 免费版 15 分钟无请求会休眠，下次访问要等 30~50 秒
