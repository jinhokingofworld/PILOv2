# Canvas Styles

`canvas.css`는 Canvas route에서 한 번만 불러오는 전역 스타일 진입점이다.

현재 tldraw override와 Canvas component 스타일의 cascade 순서를 보존하기 위해
물리적인 CSS 분리는 하지 않는다. 스타일을 나눌 때는 아래 순서를 유지한다.

1. screen shell
2. toolbar와 popover
3. Canvas runtime notice
4. tldraw built-in override
5. editor overlay와 selection toolbar
6. frame과 custom shape
7. zoom, trash, responsive rule

CSS를 여러 파일로 나누더라도 route import는 `canvas.css` 하나로 유지하고,
`canvas.css`가 고정된 순서로 하위 파일을 불러오게 한다.
