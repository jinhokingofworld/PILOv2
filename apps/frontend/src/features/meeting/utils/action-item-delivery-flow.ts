export async function saveThenDeliverActionItem({
  deliver,
  needsSave,
  save
}: {
  deliver: () => Promise<void>;
  needsSave: boolean;
  save: () => Promise<boolean>;
}): Promise<boolean> {
  if (needsSave && !(await save())) {
    return false;
  }

  await deliver();
  return true;
}
