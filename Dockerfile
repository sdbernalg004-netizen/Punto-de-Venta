# DOCKERFILE OPTIMIZADO PARA DESPLIEGUE EN LA NUBE (RENDER, RAILWAY, FLY.IO)
FROM node:24-alpine

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production

# Copiar el código fuente de la aplicación
COPY . .

# Exponer el puerto del servidor
EXPOSE 3000

# Variable de entorno por defecto
ENV PORT=3000
ENV NODE_ENV=production

# Comando para iniciar el servidor
CMD ["node", "src/backend/server.js"]
