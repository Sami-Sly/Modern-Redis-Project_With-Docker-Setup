# 1️⃣ Base image
FROM node:18-alpine AS builder

# 2️⃣ Set working directory
WORKDIR /app

# 3️⃣ Copy package files first for caching dependencies
COPY package*.json ./

# 4️⃣ Install dependencies
RUN npm ci

# 5️⃣ Copy all source code
COPY . .

# 6️⃣ Build TypeScript → dist/
RUN npm run build

# # -----------------------------
# # 7️⃣ Production stage
# FROM node:18-alpine AS runner
# WORKDIR /app

# # 8️⃣ Copy only necessary files from builder
# COPY --from=builder /app/package*.json ./
# COPY --from=builder /app/dist ./dist

# # 9️⃣ Install only production deps
# RUN npm ci --omit=dev

# # 10️⃣ Expose app port
# EXPOSE 7000

# 11️⃣ Run compiled JS file
CMD ["node", "dist/index.js"]
