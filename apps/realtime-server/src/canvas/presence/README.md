# Canvas Presence

Canvas 사용자의 커서, 선택 shape, viewport와 편집 의도를 room 단위로 보관한다.

presence는 협업 표시를 위한 휘발성 상태이며 shape 저장이나 history에 포함하지
않는다. leave와 disconnect 시 socket의 presence를 제거하고 다른 사용자에게
leave 이벤트를 전달할 데이터를 반환한다.
