# APP 提单接入说明

各 APP 通过一个 HTTP 接口把缺陷提交到缺陷管理平台，平台自动建单并返回缺陷编号。本文给 APP 开发同学看。

## 1. 接入前准备

1. 确定 APP 标识（`appId`），一般用包名或 Bundle ID，如 `com.bud.shop`。iOS 和安卓可以用不同的标识。
2. 请平台管理员在「项目设置 → APP 接入」里把这个标识绑定到对应项目。一个标识只能绑定一个项目，提交的缺陷都会建到这个项目。
3. 接口不需要登录或密钥。提单入口只开放给 APP 内的白名单用户（测试、内部人员），由 APP 自己控制。

## 2. 接口

```
POST {平台地址}/api/v1/app/defects
Content-Type: multipart/form-data
```

平台地址就是浏览器打开缺陷平台用的地址，如 `https://defects.example.com`。「项目设置 → APP 接入」页面上可以直接复制完整的接口地址。

### 表单字段

| 字段           | 必填 | 说明                                                                                        |
| -------------- | ---- | ------------------------------------------------------------------------------------------- |
| `appId`        | 是   | APP 标识，必须已在平台绑定到项目                                                            |
| `description`  | 是   | 缺陷描述（用户输入或语音转写后的文字），最多 20000 字                                       |
| `reportId`     | 建议 | 本次提交的唯一 ID（UUID）。网络超时重试时**用同一个值**，平台不会重复建单，直接返回原编号   |
| `reporterName` | 建议 | 提单人姓名。和平台用户姓名完全一致时，自动记为该用户提的单；匹配不上时只把姓名写进描述      |
| `title`        | 否   | 标题，最多 120 字。不传时取描述的第一句话（最多 60 字）                                     |
| `severity`     | 否   | 严重程度：`fatal` 致命、`serious` 严重、`normal` 一般（默认）、`prompt` 提示、`advice` 建议 |
| `frequency`    | 否   | 重现规律：`always` 可重现、`random` 随机重现、`never` 不可重现                              |
| `steps`        | 否   | 复现步骤                                                                                    |
| `appVersion`   | 否   | APP 版本号，如 `3.12.0`                                                                     |
| `appBuild`     | 否   | 构建号，如 `31200`                                                                          |
| `appCommit`    | 否   | 构建对应的代码提交，便于开发定位                                                            |
| `deviceModel`  | 否   | 设备型号，如 `Pixel 9`、`iPhone 15`                                                         |
| `osVersion`    | 否   | 系统版本，如 `Android 15`、`iOS 18.1`                                                       |
| `page`         | 否   | 出问题的页面                                                                                |
| `extra`        | 否   | 其他上下文，**JSON 对象字符串**，如 `{"network":"WIFI","uid":"..."}`，原样保存              |
| `files`        | 否   | 附件，可以重复多次（每个文件一个 `files` 字段）                                             |

空字符串按「没填」处理。

### 附件

- 一次最多 10 个文件，单个不超过 200 MB，合计不超过 500 MB。
- 按扩展名识别类型：
  - 截图：`png` `jpg` `jpeg` `webp` `gif`
  - 录屏：`mp4` `mov` `webm` `m4v`，平台会自动抽关键帧
  - 日志：`log` `txt` `zip`，平台会自动解析出异常摘要；`zip` 里可以放多个日志文件
  - 其他文件原样保存，比如原始录音 `m4a`，便于回听核对
- 文件名支持中文，同名文件会自动加序号。

### 返回

成功时返回 HTTP 201：

```json
{
  "reportId": "1f0c6a0e-5b1a-4f7e-9a51-2c1d3e4f5a6b",
  "code": "APP-23",
  "url": "/p/APP/bugs/APP-23",
  "created": true
}
```

- `code`：缺陷编号，可以提示给用户，比如「已提交，编号 APP-23」。
- `url`：缺陷详情页路径，拼上平台地址就能打开。
- `created`：`false` 表示这个 `reportId` 之前已经建过单（重试），返回的是原来的编号。

失败时返回 JSON `{ "statusCode": 400, "message": "原因" }`：

| 状态码     | 原因                                                                           | APP 怎么处理                      |
| ---------- | ------------------------------------------------------------------------------ | --------------------------------- |
| 400        | 缺少 `appId` / `description`，字段取值不对，`appId` 没绑定项目，文件超过 10 个 | 把 `message` 提示给用户，不要重试 |
| 413        | 单个文件超过 200 MB，或整个请求超过 512 MB                                     | 提示压缩录屏后再提交              |
| 429        | 同一个 IP 请求太频繁                                                           | 稍后重试                          |
| 5xx / 超时 | 平台或网络异常                                                                 | 用**同一个 `reportId`** 重试      |

## 3. 示例

### curl

```bash
curl -X POST https://defects.example.com/api/v1/app/defects \
  -F appId=com.bud.shop \
  -F reportId=$(uuidgen) \
  -F "description=支付成功后返回 APP，订单页仍显示待支付" \
  -F reporterName=张三 \
  -F appVersion=3.12.0 -F deviceModel="Pixel 9" -F osVersion="Android 15" \
  -F files=@screenshot.png -F files=@record.mp4 -F files=@app.log
```

### Android（OkHttp）

```kotlin
val body = MultipartBody.Builder().setType(MultipartBody.FORM)
    .addFormDataPart("appId", BuildConfig.APPLICATION_ID)
    .addFormDataPart("reportId", reportId)            // 首次提交时生成并保存，重试时复用
    .addFormDataPart("description", description)
    .addFormDataPart("reporterName", reporterName)
    .addFormDataPart("appVersion", BuildConfig.VERSION_NAME)
    .addFormDataPart("deviceModel", Build.MODEL)
    .addFormDataPart("osVersion", "Android ${Build.VERSION.RELEASE}")
    .apply {
        files.forEach { f ->
            addFormDataPart("files", f.name, f.asRequestBody("application/octet-stream".toMediaType()))
        }
    }
    .build()
val request = Request.Builder().url("$baseUrl/api/v1/app/defects").post(body).build()
// 录屏较大时把 OkHttpClient 的 writeTimeout / readTimeout 调到 5 分钟以上
```

### iOS（URLSession）

```swift
var request = URLRequest(url: URL(string: "\(baseURL)/api/v1/app/defects")!)
request.httpMethod = "POST"
let boundary = UUID().uuidString
request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
var body = Data()
func field(_ name: String, _ value: String) {
    body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
}
func file(_ url: URL) throws {
    body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"files\"; filename=\"\(url.lastPathComponent)\"\r\nContent-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
    body.append(try Data(contentsOf: url))
    body.append("\r\n".data(using: .utf8)!)
}
field("appId", Bundle.main.bundleIdentifier!)
field("reportId", reportId)
field("description", description)
field("reporterName", reporterName)
try attachments.forEach(file)
body.append("--\(boundary)--\r\n".data(using: .utf8)!)
// 录屏较大时用 uploadTask(with:fromFile:) 先把 body 写到临时文件再上传，避免占用太多内存
```

### Unity（UnityWebRequest）

```csharp
var form = new List<IMultipartFormSection> {
    new MultipartFormDataSection("appId", Application.identifier),
    new MultipartFormDataSection("reportId", reportId),
    new MultipartFormDataSection("description", description),
    new MultipartFormDataSection("reporterName", reporterName),
    new MultipartFormDataSection("appVersion", Application.version),
    new MultipartFormDataSection("deviceModel", SystemInfo.deviceModel),
    new MultipartFormDataSection("osVersion", SystemInfo.operatingSystem),
};
foreach (var path in attachmentPaths)
    form.Add(new MultipartFormFileSection("files", File.ReadAllBytes(path), Path.GetFileName(path), "application/octet-stream"));
using var req = UnityWebRequest.Post($"{baseUrl}/api/v1/app/defects", form);
req.timeout = 300;
yield return req.SendWebRequest();
```

## 4. 语音描述

**建议在 APP 端转成文字后再提交**，平台只接收文字描述：

- 用手机系统自带的语音识别（iOS 的 Speech 框架、安卓的 SpeechRecognizer），不花钱，也不消耗大模型（如 Claude）的 token。
- 边说边出字，用户提交前能看到并改正识别错的地方，开发看到的描述更准确。
- 如果想保留原始录音便于核对，可以把录音文件（如 `m4a`）作为附件一起传，平台原样保存，不做识别。

## 5. 联调

- 平台仓库里有模拟脚本，不用 APP 也能验证接口：在 `apps/server` 目录执行 `npx tsx scripts/simulate-app-defect.ts --app <APP 标识> --base <平台地址>`。
- 提交记录、成功和失败数以及失败原因，在平台「统计报表 → APP 提单」里查看。
