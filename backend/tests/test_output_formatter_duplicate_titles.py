import unittest

from app.models.entities import TaskType
from app.services.output_formatter import format_generated_output


class OutputFormatterDuplicateTitleTests(unittest.TestCase):
    def test_create_uses_task_title_and_removes_exact_duplicate_leading_title(self) -> None:
        formatted = format_generated_output(
            task_type=TaskType.create,
            raw_output=(
                "创建任务标题\n"
                "正文第一段\n"
                "小红书推荐正文\n"
                "这是一段推荐正文。\n"
                "#原创 #标题"
            ),
            task_title="创建任务标题",
        )

        self.assertEqual(
            formatted.full_output,
            "创建任务标题\n\n"
            "正文第一段\n\n"
            "小红书推荐正文：\n"
            "这是一段推荐正文。\n\n"
            "#原创 #标题",
        )

    def test_create_removes_prefixed_duplicate_title(self) -> None:
        formatted = format_generated_output(
            task_type=TaskType.create,
            raw_output=(
                "标题：我好像发现主谓宾定状补学生能全听懂的方法\n"
                "很多老师一讲语法就头疼。\n"
                "小红书推荐正文\n"
                "推荐正文。\n"
                "#原创 #语法"
            ),
            task_title="我好像发现主谓宾定状补学生能全听懂的方法",
        )

        self.assertEqual(
            formatted.full_output,
            "我好像发现主谓宾定状补学生能全听懂的方法\n\n"
            "很多老师一讲语法就头疼。\n\n"
            "小红书推荐正文：\n"
            "推荐正文。\n\n"
            "#原创 #语法",
        )

    def test_create_removes_split_title_label_and_value(self) -> None:
        formatted = format_generated_output(
            task_type=TaskType.create,
            raw_output=(
                "标题\n"
                "班主任累的原因是什么都管，还管得很认真\n"
                "很多老师从早忙到晚。\n"
                "小红书推荐正文\n"
                "推荐正文。\n"
                "#原创 #班主任"
            ),
            task_title="班主任累的原因是什么都管，还管得很认真",
        )

        self.assertEqual(
            formatted.full_output,
            "班主任累的原因是什么都管，还管得很认真\n\n"
            "很多老师从早忙到晚。\n\n"
            "小红书推荐正文：\n"
            "推荐正文。\n\n"
            "#原创 #班主任",
        )

    def test_create_removes_mismatched_generated_title_and_keeps_task_title(self) -> None:
        formatted = format_generated_output(
            task_type=TaskType.create,
            raw_output=(
                "高管在观察你，你却以为他在忙别的事\n"
                "刚升中层那会儿，我觉得只要把事做好就行了。\n"
                "小红书推荐正文\n"
                "推荐正文。\n"
                "#管理 #中层"
            ),
            task_title="高管会怎样观察一个新中层？",
        )

        self.assertEqual(
            formatted.full_output,
            "高管会怎样观察一个新中层？\n\n"
            "刚升中层那会儿，我觉得只要把事做好就行了。\n\n"
            "小红书推荐正文：\n"
            "推荐正文。\n\n"
            "#管理 #中层",
        )

    def test_framework_prefers_extracted_title_and_removes_prefixed_duplicate(self) -> None:
        formatted = format_generated_output(
            task_type=TaskType.framework,
            raw_output=(
                "大标题：框架正式标题\n"
                "正文第一段\n"
                "小红书推荐正文\n"
                "推荐正文。\n"
                "#框架 #标题"
            ),
            task_title="任务标题",
            extracted_title="框架正式标题",
        )

        self.assertEqual(
            formatted.full_output,
            "框架正式标题\n\n"
            "正文第一段\n\n"
            "小红书推荐正文：\n"
            "推荐正文。\n\n"
            "#框架 #标题",
        )

    def test_framework_removes_orphaned_recommendation_label_before_tags(self) -> None:
        formatted = format_generated_output(
            task_type=TaskType.framework,
            raw_output=(
                "正文第一段\n"
                "推荐正文正文正文\n"
                "\n"
                "小红书推荐正文：\n"
                "\n"
                "#框架 #标签"
            ),
            task_title="任务标题",
            extracted_title="框架正式标题",
        )

        self.assertEqual(
            formatted.full_output,
            "框架正式标题\n\n"
            "正文第一段\n"
            "推荐正文正文正文\n\n"
            "#框架 #标签",
        )

    def test_framework_does_not_output_empty_recommendation_section(self) -> None:
        formatted = format_generated_output(
            task_type=TaskType.framework,
            raw_output=(
                "正文第一段\n"
                "\n"
                "小红书推荐正文：\n"
                "\n"
                "#框架 #标签"
            ),
            task_title="任务标题",
            extracted_title="框架正式标题",
        )

        self.assertEqual(
            formatted.full_output,
            "框架正式标题\n\n"
            "正文第一段\n\n"
            "#框架 #标签",
        )

    def test_create_removes_heavy_separator_lines(self) -> None:
        formatted = format_generated_output(
            task_type=TaskType.create,
            raw_output=(
                "别浪费下属给你的每一份恶意\n"
                "━━━━━━━━━━━━\n"
                "正文第一段。\n"
                "━━━━━━━━━━━━\n"
                "小红书推荐正文：\n"
                "━━━━━━━━━━━━\n"
                "推荐正文。\n"
                "━━━━━━━━━━━━\n"
                "小红书标签\n"
                "━━━━━━━━━━━━\n"
                "#管理 #团队"
            ),
            task_title="别浪费下属给你的每一份恶意",
        )

        self.assertEqual(
            formatted.full_output,
            "别浪费下属给你的每一份恶意\n\n"
            "正文第一段。\n\n"
            "小红书推荐正文：\n"
            "推荐正文。\n\n"
            "#管理 #团队",
        )


if __name__ == "__main__":
    unittest.main()
