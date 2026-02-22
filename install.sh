#!/usr/bin/env bash
# ============================================================================
# Jarvis Inc. — One-Line Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/GGCryptoh/jarvis_inc/main/install.sh | bash
#
# What it does:
#   1. Checks prerequisites (git, node >= 18, docker)
#   2. Clones the repo (or pulls if it already exists)
#   3. Installs npm dependencies
#   4. Runs `npm run jarvis` (auto-setup Docker + Supabase + dev server)
# ============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

REPO_URL="https://github.com/GGCryptoh/jarvis_inc.git"
INSTALL_DIR="jarvis_inc"

echo ""
echo -e "${CYAN}${BOLD}"
echo "     ╔══════════════════════════════════════╗"
echo "     ║        JARVIS INC. INSTALLER         ║"
echo "     ║   Autonomous AI Workforce Dashboard  ║"
echo "     ╚══════════════════════════════════════╝"
echo -e "${NC}"

# ── Check prerequisites ─────────────────────────────────────────────────────

check_command() {
  if ! command -v "$1" &> /dev/null; then
    echo -e "  ${RED}✗${NC} $1 — not found"
    return 1
  fi
  echo -e "  ${GREEN}✓${NC} $1 — $(command -v "$1")"
  return 0
}

echo -e "${BOLD}Checking prerequisites...${NC}"
echo ""

MISSING=0

# Git
if ! check_command git; then
  echo -e "    ${YELLOW}Install: https://git-scm.com/downloads${NC}"
  MISSING=1
fi

# Node.js >= 18
if command -v node &> /dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "  ${RED}✗${NC} node — v$(node -v) (need >= 18)"
    echo -e "    ${YELLOW}Update: https://nodejs.org${NC}"
    MISSING=1
  else
    echo -e "  ${GREEN}✓${NC} node — $(node -v)"
  fi
else
  echo -e "  ${RED}✗${NC} node — not found"
  echo -e "    ${YELLOW}Install: https://nodejs.org (LTS recommended)${NC}"
  MISSING=1
fi

# npm
check_command npm || MISSING=1

# Docker
if command -v docker &> /dev/null; then
  if docker info &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} docker — running"
  else
    echo -e "  ${YELLOW}!${NC} docker — installed but not running"
    echo -e "    ${YELLOW}Start Docker Desktop or the Docker daemon first${NC}"
    MISSING=1
  fi
else
  echo -e "  ${RED}✗${NC} docker — not found"
  echo -e "    ${YELLOW}Install: https://docs.docker.com/get-docker/${NC}"
  MISSING=1
fi

# Docker Compose
if docker compose version &> /dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} docker compose — $(docker compose version --short 2>/dev/null || echo 'available')"
elif command -v docker-compose &> /dev/null; then
  echo -e "  ${GREEN}✓${NC} docker-compose — $(docker-compose version --short 2>/dev/null || echo 'available')"
else
  echo -e "  ${RED}✗${NC} docker compose — not found"
  echo -e "    ${YELLOW}Included with Docker Desktop, or install the compose plugin${NC}"
  MISSING=1
fi

echo ""

if [ "$MISSING" -eq 1 ]; then
  echo -e "${RED}${BOLD}Missing prerequisites. Install them and re-run this script.${NC}"
  echo ""
  exit 1
fi

echo -e "${GREEN}All prerequisites met.${NC}"
echo ""

# ── Clone or update repo ────────────────────────────────────────────────────

if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "${BOLD}Updating existing installation...${NC}"
  cd "$INSTALL_DIR"
  git pull --rebase || true
else
  echo -e "${BOLD}Cloning Jarvis Inc...${NC}"
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Init submodules (skills_repo)
echo -e "${BOLD}Initializing submodules...${NC}"
git submodule update --init --recursive

# ── Install dependencies ────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Installing dependencies...${NC}"
npm install

# ── Launch ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}${BOLD}"
echo "  ┌────────────────────────────────────────────┐"
echo "  │  Ready to launch!                          │"
echo "  │                                            │"
echo "  │  This will:                                │"
echo "  │    1. Generate secrets & .env              │"
echo "  │    2. Start Docker (Supabase + Caddy)      │"
echo "  │    3. Wait for all services                │"
echo "  │    4. Open Vite dev server at :5173        │"
echo "  │                                            │"
echo "  │  First run takes 2-3 minutes for Docker    │"
echo "  │  images to download.                       │"
echo "  └────────────────────────────────────────────┘"
echo -e "${NC}"

npm run jarvis
