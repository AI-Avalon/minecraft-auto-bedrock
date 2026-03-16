const os = require('os');

function main() {
  const platform = os.platform();

  console.log('PM2 自動復旧手順:');
  console.log('1. npm run pm2:start');
  console.log('2. npm run pm2:save');

  if (platform === 'darwin') {
    console.log('3. pm2 startup launchd -u $USER --hp $HOME');
  } else if (platform === 'win32') {
    console.log('3. npm install -g pm2-windows-startup');
    console.log('4. pm2-startup install');
  } else {
    console.log('3. pm2 startup systemd -u $USER --hp $HOME');
  }

  console.log('4. 表示された sudo コマンドを実行して完了です。');
}

main();
