FROM mcr.microsoft.com/playwright:v1.63.0-noble

ARG PLAYWRIGHT_MCP_VERSION=0.0.81

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN npm install --global @playwright/mcp@${PLAYWRIGHT_MCP_VERSION} \
 && playwright-mcp install-browser chrome-for-testing \
 && npm cache clean --force

USER pwuser

EXPOSE 8931

CMD ["playwright-mcp", \
     "--browser", "chromium", \
     "--headless", \
     "--no-sandbox", \
     "--isolated", \
     "--host", "0.0.0.0", \
     "--port", "8931", \
     "--allowed-hosts", "*"]
