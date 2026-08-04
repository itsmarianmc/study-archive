FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm install
COPY . .

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "const fs=require('fs');try{const t=new Date(fs.readFileSync('/app/data/pipeline-heartbeat.txt','utf8')).getTime();process.exit((Date.now()-t)<90000?0:1)}catch(e){process.exit(1)}"

CMD ["npx", "tsx", "src/index.ts"]
