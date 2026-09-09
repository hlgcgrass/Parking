【放小程序代码上传密钥】

请把 private.wx74cf1625553c595b.key 放到本目录下，然后返回上级目录双击 deploy-cloud.bat 即可自动部署云函数。

获取步骤：
1. 登录 https://mp.weixin.qq.com
2. 开发与服务 → 开发管理 → 开发设置 → 代码上传密钥 → 生成并下载
3. 同页面设置「IP 白名单」：填你的公网 IP，或关闭限制
   （不配白名单会报错 ip not in whitelist）

如果不想用命令行部署，也可以直接在微信开发者工具里右键 cloudfunctions/parking
→「上传并部署：云端安装依赖」，效果一样，且不需要这个密钥。
