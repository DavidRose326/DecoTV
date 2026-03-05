# ---- 第 1 阶段：依赖预下载 (Deps) ----
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
# 启用 corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# 只复制 lock 文件以利用缓存
COPY pnpm-lock.yaml ./
# 这里的 fetch 可以让依赖层在 package.json 没变时完全缓存
RUN pnpm fetch

# 复制清单并安装
COPY package.json ./
RUN pnpm install --offline --frozen-lockfile

# ---- 第 2 阶段：项目构建 (Builder) ----
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# 从第一阶段复制依赖
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 设置构建变量
ENV DOCKER_BUILD=true
ENV NEXT_TELEMETRY_DISABLED=1

# 注入构建时变量 (弹弹play)
ARG DANDANPLAY_APP_ID
ARG DANDANPLAY_APP_SECRET

RUN pnpm run build

# ---- 第 3 阶段：生产运行镜像 (Runner) ----
FROM node:20-alpine AS runner

# 1. 基础环境配置
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

# 2. 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -u 1001 -S nextjs -G nodejs

# 3. 复制静态资源和独立包
# 提示：standalone 模式将所有 node_modules 提取到了 server.js 同级
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# 显式复制启动脚本和工具脚本（确保路径与 start.js 内一致）
COPY --from=builder --chown=nextjs:nodejs /app/start.js ./start.js
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

# 4. [关键] 为 Standalone 模式补充 Sharp
# Next.js standalone 偶尔不会包含原生 Sharp 二进制文件，手动安装确保图片组件可用
RUN npm install sharp

# 5. 弹弹play 运行时变量处理
ARG DANDANPLAY_APP_ID
ARG DANDANPLAY_APP_SECRET
ENV DANDANPLAY_APP_ID=${DANDANPLAY_APP_ID}
ENV DANDANPLAY_APP_SECRET=${DANDANPLAY_APP_SECRET}

# 6. 设置用户与端口
USER nextjs
EXPOSE 3000

# 使用你优化后的 start.js
# 它会处理 generate-manifest、启动 server.js 并执行 cron
CMD ["node", "start.js"]
