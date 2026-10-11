# PicList → EVA 素材库钩子

## 配置

1. `cp scripts/.env.example scripts/.env`，填入与 EVA 一致的 Token。
2. 在 PicList 自定义上传后脚本中调用：

```bash
node /Users/xiyangxie/workspace/personal/eva/scripts/piclist/on-upload-success.mjs
```

PicList 若支持把上传结果 JSON 写入 stdin / 环境变量，脚本会自动读取；也可：

```bash
echo '{"imgUrl":"https://...","fileName":"a.png"}' | node scripts/piclist/on-upload-success.mjs
```

## 手工验收

```bash
export EVA_TOKEN=eva-local-token
curl -s -X POST http://127.0.0.1:14220/api/assets/ingest \
  -H "Authorization: Bearer $EVA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cdnUrl":"https://example.com/demo.png","filename":"demo.png","source":"manual","tags":["test"]}'

curl -s -H "Authorization: Bearer $EVA_TOKEN" 'http://127.0.0.1:14220/api/assets?limit=5'
```
