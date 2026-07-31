FROM node:22-bookworm-slim

# ffmpeg (cutting/captioning/reformatting) + python3/pip (librosa energy &
# beat analysis) — both are real runtime dependencies of this worker, not
# optional extras.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY requirements.txt ./
RUN pip3 install --break-system-packages --no-cache-dir -r requirements.txt

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm install --include=dev && npm run build && npm prune --omit=dev

ENV PYTHON_BIN=python3
CMD ["node", "dist/index.js"]
