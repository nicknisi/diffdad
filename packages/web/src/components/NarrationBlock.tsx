import { Markdown } from "./markdown/Markdown";

type Props = {
  content: string;
};

export function NarrationBlock({ content }: Props) {
  return (
    <div className="ml-[34px] text-base leading-relaxed text-gray-700 dark:text-gray-300">
      <Markdown source={content} />
    </div>
  );
}
