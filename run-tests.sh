#!/usr/bin/env bash

# Minecraft Auto Bedrock - テスト実行スクリプト
# 使用方法: bash run-tests.sh [quick|full|gui]

set -e

PROJECT_NAME="minecraft-auto-bedrock"
PROJECT_VERSION="2.0.0"
TEST_TYPE="${1:-full}"

# カラー設定
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ロゴ
print_header() {
  echo -e "${BLUE}"
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║  🎮 ${PROJECT_NAME} v${PROJECT_VERSION}                  ║"
  echo "║  統合テストスイート                                           ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
}

# テスト結果表示
print_test_result() {
  local test_name=$1
  local status=$2
  local details=$3
  
  if [ "$status" = "pass" ]; then
    echo -e "${GREEN}✓${NC} $test_name"
    [ ! -z "$details" ] && echo "  $details"
  elif [ "$status" = "fail" ]; then
    echo -e "${RED}✗${NC} $test_name"
    [ ! -z "$details" ] && echo "  $details"
  else
    echo -e "${YELLOW}⚠${NC} $test_name"
    [ ! -z "$details" ] && echo "  $details"
  fi
}

# システムチェック
check_system() {
  echo -e "\n${BLUE}========== システムチェック ==========${NC}\n"
  
  # Node.js
  if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'.' -f1 | cut -d'v' -f2)
    if [ "$MAJOR_VERSION" -ge 20 ]; then
      print_test_result "Node.js ($NODE_VERSION)" "pass" "推奨バージョン"
    else
      print_test_result "Node.js ($NODE_VERSION)" "warn" "推奨: v20.0.0+"
    fi
  else
    print_test_result "Node.js" "fail" "インストールが必要です"
    exit 1
  fi
  
  # npm
  if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    print_test_result "npm ($NPM_VERSION)" "pass"
  else
    print_test_result "npm" "fail"
    exit 1
  fi
  
  # PM2
  if command -v pm2 &> /dev/null; then
    PM2_VERSION=$(pm2 --version)
    print_test_result "PM2 ($PM2_VERSION)" "pass"
  else
    print_test_result "PM2" "fail" "システム診断のみで進行"
  fi
  
  # git
  if command -v git &> /dev/null; then
    GIT_VERSION=$(git --version | awk '{print $3}')
    print_test_result "Git ($GIT_VERSION)" "pass"
  else
    print_test_result "Git" "warn" "オプション"
  fi
}

# ユニットテスト実行
run_unit_tests() {
  echo -e "\n${BLUE}========== 包括的テスト実行 ==========${NC}\n"
  
  if npm run test:comprehensive 2>&1 | tee /tmp/comprehensive-test.log; then
    TEST_COUNT=$(grep "# pass" /tmp/comprehensive-test.log | awk '{print $3}' || echo "複数")
    print_test_result "包括的テスト" "pass" "$TEST_COUNT テスト成功"
  else
    print_test_result "包括的テスト" "fail"
    return 1
  fi

  echo -e "\n${BLUE}========== ユニットテスト実行 ==========${NC}\n"
  
  if npm test 2>&1 | tee /tmp/unit-test.log; then
    TEST_COUNT=$(grep -c "✔" /tmp/unit-test.log || echo "未知")
    print_test_result "ユニットテスト" "pass" "$TEST_COUNT テスト成功"
    return 0
  else
    print_test_result "ユニットテスト" "fail" "一部テスト失敗"
    return 1
  fi
}

# GUI テスト実行
run_gui_tests() {
  echo -e "\n${BLUE}========== GUI インテグレーションテスト ==========${NC}\n"
  
  if npm run test:gui 2>&1 | tee /tmp/gui-test.log; then
    PASS_COUNT=$(grep "✔" /tmp/gui-test.log | wc -l)
    print_test_result "GUI テスト" "pass" "$PASS_COUNT テスト成功"
    return 0
  else
    print_test_result "GUI テスト" "fail"
    return 1
  fi
}

# システム診断
run_system_doctor() {
  echo -e "\n${BLUE}========== システム診断 ==========${NC}\n"
  
  if npm run doctor 2>&1; then
    print_test_result "システム診断" "pass"
    return 0
  else
    print_test_result "システム診断" "fail"
    return 1
  fi
}

# 快速テスト（system check + doctor）
run_quick_tests() {
  print_header
  check_system
  run_system_doctor
  
  echo -e "\n${GREEN}✓ 快速テスト完了${NC}\n"
}

# 完全テスト
run_full_tests() {
  print_header
  check_system
  run_system_doctor
  
  UNIT_PASS=0
  GUI_PASS=0
  
  run_unit_tests && UNIT_PASS=1
  run_gui_tests && GUI_PASS=1
  
  echo -e "\n${BLUE}========== テスト結果サマリー ==========${NC}\n"
  [ "$UNIT_PASS" = "1" ] && print_test_result "ユニットテスト" "pass" || print_test_result "ユニットテスト" "fail"
  [ "$GUI_PASS" = "1" ] && print_test_result "GUI テスト" "pass" || print_test_result "GUI テスト" "fail"
  
  if [ "$UNIT_PASS" = "1" ] && [ "$GUI_PASS" = "1" ]; then
    echo -e "\n${GREEN}✓ すべてのテストに成功しました！${NC}\n"
    return 0
  else
    echo -e "\n${RED}✗ 一部テストが失敗しました${NC}\n"
    return 1
  fi
}

# GUI テストのみ
run_gui_only() {
  print_header
  run_gui_tests
  
  if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}✓ GUI テスト完了${NC}\n"
    return 0
  else
    echo -e "\n${RED}✗ GUI テスト失敗${NC}\n"
    return 1
  fi
}

# メイン処理
case "$TEST_TYPE" in
  quick)
    run_quick_tests
    ;;
  gui)
    run_gui_only
    ;;
  full)
    run_full_tests
    ;;
  *)
    echo "使用方法: bash run-tests.sh [quick|full|gui]"
    echo ""
    echo "オプション:"
    echo "  quick  - システムチェック + システム診断のみ"
    echo "  gui    - GUI インテグレーションテストのみ"
    echo "  full   - 全テスト実行（デフォルト）"
    exit 1
    ;;
esac
