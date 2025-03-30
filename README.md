# openledger-phase2
Update tool openledger (https://testnet.openledger.xyz/?referral_code=3jf4iqmpey) sử dụng nodejs (noproxy và proxy)

🌐 Link:  Openledger (https://testnet.openledger.xyz/?referral_code=3jf4iqmpey)

⬇️ Link:  Extension (https://chromewebstore.google.com/detail/openledger-node/ekbbplmjjgoobhdlffmgeokalelnmjjc)

✔️ Update epoch 2

✔️ Cập nhật storage local

✔️ Auto ping

✔️ Các chức năng khác giữ nguyên

===========================
🖥 Hướng dẫn (yêu cầu có nodejs):

1️⃣ ```git clone https://github.com/pmhieu111/openledger-phase2.git \
    cd openledger-phase2```

1️⃣ ```npm install``` để cập nhật module.

2️⃣  tokens.txt lưu token (hạn 1 năm). Cách lấy xem dưới ⬇️

proxy.txt lưu proxy định dạng proxy: http://user:pass@ip:port  (ae nào dùng proxy thì thêm vào)

3️⃣ Chạy tool bằng lệnh: node main

lấy token:
Truy cập web => F12 (chuột phải/inspect) => qua tab console => dán đoạn code dưới vào (nếu không dán được thì nhập thủ công allow pasting trước rồi dán lại)
```js
function getCookieValue(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

// Lấy giá trị cookie
const token = getCookieValue('opw_base_user_token');
console.log(token);
```
