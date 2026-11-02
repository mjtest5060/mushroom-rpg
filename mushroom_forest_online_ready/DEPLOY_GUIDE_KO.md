# 🍄 버섯숲의 전설: 링크 접속 버전 배포 안내 (Render)

이 폴더는 **온라인 배포용 원본 프로젝트**입니다. ZIP을 다운로드하는 것만으로 공개 주소가 발급되지는 않습니다. **GitHub 저장소와 Render 웹 서버를 본인 계정으로 생성**해야 인터넷 어디에서나 게임에 접속할 수 있습니다.

## 가장 쉬운 방법: Render Blueprint

1. [github.com/new](https://github.com/new)에서 새로운 저장소를 만듭니다. 저장소 이름 예: `mushroom-rpg`; 공개(Public) 또는 비공개(Private)는 원하는 대로 선택합니다. 새 저장소 초기화 옵션(README)은 비워두면 편합니다.
2. 생성된 저장소에서 **Add file → Upload files**로 들어갑니다. 이 ZIP을 먼저 압축 해제하고, 압축 해제한 폴더 **안에 있는 파일과 `public`, `test` 폴더를 포함한 전체 내용**을 업로드한 뒤 **Commit changes**를 누릅니다. `server.js`와 `render.yaml`이 저장소 최상위에 있어야 합니다. ZIP 파일 한 개만 올리면 실행되지 않습니다.
3. [Render 대시보드](https://dashboard.render.com/)에 로그인한 뒤 **New → Blueprint**를 선택하고 GitHub 계정을 연결합니다. 1~2번에서 만든 저장소를 지정합니다. Render가 `render.yaml`을 읽고 웹 서비스를 생성하도록 승인합니다. (UI 명칭은 바뀔 수 있습니다.)
4. Deploy 상태가 **Live**가 되면 Render의 **`https://...onrender.com`** 주소를 클릭합니다. 첫 배포가 성공하기 전에는 공개 링크가 아직 존재하지 않습니다.
5. 웹사이트에서 닉네임을 적고 **새 방 만들기**를 누른 뒤 **초대 링크 복사** 버튼을 눌러 친구에게 보냅니다.
6. 친구는 링크를 열고 닉네임을 적은 뒤 **친구 방에서 바로 시작** 버튼을 누릅니다. 여러 브라우저 및 다른 네트워크에서 최대 8명이 같은 방에 접속할 수 있습니다.

### Blueprint 대신 Web Service로 만들 때

Render 대시보드에서 **New → Web Service → GitHub 저장소 연결** 후 다음 값을 입력합니다.

| 항목 | 값 |
|---|---|
| Language/Runtime | `Node` |
| Region | `Singapore` (선택 가능 시) |
| Build Command | `npm install --omit=dev --ignore-scripts` |
| Start Command | `npm start` |
| Instance | `Free` (테스트용) |
| Health Check Path | `/health` |

Node.js 20 이상이 필요합니다. `render.yaml`은 싱가포르 리전과 무료 인스턴스를 지정하며, 서비스명은 다른 사용자가 쓰고 있으면 Render에서 다르게 지정될 수 있습니다. 실제 발급 주소는 Render 대시보드에서 확인하세요.

## 배포 전 로컬 점검

Node.js 20 이상을 설치한 컴퓨터에서 다음을 실행합니다.

```bash
npm test
npm start
```

- `http://localhost:3000` : 게임
- `http://localhost:3000/health` : 서버 상태 JSON

## 꼭 알아둘 제한

- **무료 Render 인스턴스는 15분 동안 요청이 없으면 잠들 수 있습니다.** 다음 접속 시 다시 켜지는 데 시간이 걸릴 수 있습니다.
- **게임 진행도는 서버 메모리에만 유지됩니다.** 마지막 사람이 방에서 나가거나 서버가 재시작·슬립·재배포되면 방과 캐릭터 진행도가 초기화됩니다. 회원가입/영구저장은 아직 없습니다.
- **하나의 웹 서버 인스턴스만 사용**해야 방 상태가 일치합니다. 여러 인스턴스로 복제하면 서로 다른 서버의 방을 공유할 수 없습니다.
- 무료 서비스는 장시간 운영 및 대규모 공개 서비스용이 아닌 취미/테스트 용도입니다. 공개 채팅에는 개인정보를 올리지 마세요.
- `localhost` 주소나 ChatGPT 파일 링크는 인터넷 공개 게임 주소가 아닙니다. 웹 호스팅에서 발급된 HTTPS 링크를 친구에게 공유하세요.

## 오류 해결

- **Not Found / 404**: GitHub 저장소에 `server.js`와 `render.yaml`이 최상위에 있는지 확인합니다.
- **Application failed to respond**: Render Logs 탭에서 시작 오류를 확인합니다. Start Command가 `npm start`인지 확인하세요.
- **서버 연결 실패**: Render 서비스가 Live인지, 브라우저 주소가 `https://`인지 확인하고 다시 접속합니다.
- **친구가 방에 못 들어감**: 서버가 재시작되어 방이 없어졌을 수 있습니다. 호스트가 새 방을 만든 다음 초대 링크를 다시 보내세요. 방은 최대 8명입니다.

Render 공식 문서: https://render.com/docs/your-first-deploy · https://render.com/docs/blueprint-spec · https://render.com/docs/free
