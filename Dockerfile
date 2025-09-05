FROM node:20-bullseye
WORKDIR /app

# Copy manifest files only (best for cache)
COPY package.json package-lock.json ./

# Install deps – prefer lockfile, fall back to install
RUN npm ci --omit=dev || npm install --omit=dev

# Copy the rest of the app
COPY . .

CMD ["npm","start"]
