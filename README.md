# 근무·휴가 달력 PWA

모바일·태블릿 친화적인 Progressive Web App입니다.  
ntfy 토픽을 통해 수신한 프로토콜 문자열을 파싱하여 달력에 근무 종류와 연가/인원 목록을 표시합니다.

## 주요 기능

- **달력 뷰**: 날짜별 근무종류 + 연가 목록 표시
- **토픽 기반 동기화**: 설정에서 "토픽 값"만 입력 (ntfy 용어 숨김)
- **자동/수동 동기화**: 앱 실행·포그라운드 복귀 시 + 1시간 간격
- **관리자 발송 도우미**: 폼으로 프로토콜 생성·미리보기·발송·복사·일괄 발송
- **근무 패턴**: 수신 데이터 없는 미래 월에 순환 패턴 자동 적용
- **로컬 저장**: IndexedDB (토픽별 분리, 이력 보관)
- **백업/복원**: JSON 내보내기·가져오기
- **오프라인**: Service Worker 캐시

## 프로토콜 형식

```
12.5/근무종류(철야)
12.5/연가(홍길동 연가,김갑돌 병가)
12.5/연가()          ← 해당 날짜 연가 목록 비우기
```

- 여러 줄 가능
- 연도 자동 추론 (11~12월에 1.x → 다음해, 1월에 12.x → 이전해)
- 존재하지 않는 날짜(2.30 등)는 무시

## 로컬 실행

단순 정적 파일이므로 아무 HTTP 서버로 열면 됩니다.

```bash
cd calendar-pwa
npx serve .
# 또는
python3 -m http.server 8080
```

브라우저에서 `http://localhost:8080` 접속.

> 참고: `file://` 로는 Service Worker / IndexedDB가 제한될 수 있으므로 반드시 HTTP(S)로 서빙하세요.

## 배포 (정적 호스팅)

GitHub Pages / Cloudflare Pages / Vercel / Netlify 등 어디에나 폴더 전체를 올리면 됩니다.

예시 (GitHub Pages):
1. 이 폴더를 저장소에 푸시
2. Settings → Pages → Deploy from branch (main / root)

Cloudflare Pages:
- 대시보드에서 디렉터리 업로드 또는 Git 연동

## 사용 방법

1. **설정** 탭 → 토픽 값(채널 코드) 입력 후 "저장 및 동기화"
2. 관리자가 ntfy로 프로토콜 메시지를 해당 토픽에 발송
3. 앱이 자동/수동으로 수신·파싱·달력 반영
4. **발송** 탭에서 관리자가 직접 프로토콜 생성·전송 가능
5. **근무 패턴**에서 미래 월용 순환 패턴 등록

## 프로젝트 구조

```
calendar-pwa/
├── index.html
├── manifest.json
├── sw.js
├── css/styles.css
├── js/
│   ├── app.js          # 메인 로직·UI
│   ├── db.js           # IndexedDB
│   ├── parser.js       # 프로토콜 파서 + 생성기
│   ├── ntfy.js         # 수신/발송
│   └── patterns.js     # 패턴 적용
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

## 예외 처리 요약

- 토픽 변경 시 해당 토픽 데이터만 표시 (다른 토픽 데이터 혼입 방지)
- 동일 날짜 workType / leaveList 분리 저장 → 한쪽 갱신해도 다른 쪽 유지
- 연가 메시지 재수신 시 **기존 목록에 병합(추가, 중복 제거)** (빈 `연가()` 시 목록 전체 초기화)
- 메시지 ID 기준 중복 저장 방지
- 파싱 실패/일반 메시지는 무시
- CORS/네트워크 오류 시 앱 중단 없이 토스트 안내

## 개발자 참고

- 기본 ntfy 서버: `https://ntfy.sh` (코드 내 상수)
- 파서 자체 테스트: 브라우저 콘솔에서 `import { selfTest } from './js/parser.js'; selfTest();`
