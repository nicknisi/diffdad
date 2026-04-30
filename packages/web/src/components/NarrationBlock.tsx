type Props = {
  content: string;
};

export function NarrationBlock({ content }: Props) {
  return (
    <p className="ml-[34px] max-w-[64ch] text-[14.5px] leading-[22px] text-gray-700 dark:text-gray-300">
      {content}
    </p>
  );
}
