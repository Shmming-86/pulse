# syntax=docker/dockerfile:1
# Pulse 看板生产镜像：零 npm 依赖，无需 install 步骤
FROM node:22-alpine

LABEL org.opencontainers.image.title="kanban-pulse" \
      org.opencontainers.image.description="小团队任务跟踪与分析看板" \
      org.opencontainers.image.version="1.0.0"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    DATA_DIR=/app/data

WORKDIR /app

# 先复制清单再复制源码，充分利用构建缓存
COPY package.json ./
COPY server ./server
COPY public ./public

# 数据目录挂载点：容器内以 node 用户运行，需要写权限
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 4173

# 容器健康检查：复用 /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
