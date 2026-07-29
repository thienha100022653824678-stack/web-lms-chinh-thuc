# LMS Admin Multi-Site — Rollback Runbook

Rollback priority:

1. Disable `COMMERCE_LMS_SITE_ISOLATION_ENABLED`.
2. Disable `LMS_ADMIN_MULTI_SITE_ENABLED`.
3. Verify legacy behavior returns.
4. Roll code/aliases back to the recorded artifacts if needed.
5. Roll schema back only if old code is incompatible or the owner explicitly
   approves it.

Before schema rollback, export every non-NULL `courses.learning_site` delta.
Never delete course/order/lesson/enrollment/progress rows, restore the whole
database, use cascade, or rewrite legacy mappings.

Exact code rollback artifacts:

- LMS: `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`.
- Commerce `yeubep.shop`: `dpl_CQw9cUnnXVhXVHToSFEwkYzRd1iJ`.
- Commerce `shop.yeunauan.live`: `dpl_6ATmLb9HdttVfTmgD7LBMHGmfMka`.

Schema rollback artifact:
`migrations/20260729_lms_learning_site_rollback.sql`, SHA-256
`b2814c45294c93b037ec2b2d7b8266c424eec22d412c896a643908cd5e068e3c`.

| Trigger | Hành động ngay | Có rollback schema không | Kiểm tra sau rollback |
|---|---|---|---|
| HTTP 500 tăng trên ngưỡng | Tắt Commerce rồi LMS flag; rollback code nếu còn | Chỉ nếu code cũ không tương thích | 500 về baseline, B05/Commerce smoke |
| Selector sai mapping | Tắt LMS flag ngay | Không | UI cũ, mapping domain không đổi |
| Cross-site data leak | Tắt cả hai flag ngay, cô lập canary | Không mặc định | Opposite-site read bị chặn |
| Write mismatch | Tắt cả hai flag, dừng writes | Chỉ sau export delta/phê duyệt | Persisted row/canonical target đúng |
| Enrollment revoke chéo site | Tắt cả hai flag ngay | Không | Entitlement độc lập được giữ |
| Lesson/media chéo site | Tắt LMS flag ngay | Không | IDOR bị chặn, row không đổi |
| Drive action sai course | Tắt LMS flag và Drive action | Không | Không permission ngoài course |
| Migration lock/timeout | Hủy migration/transaction, giữ flags off | Có nếu transaction để lại delta | Catalog/count như P1 |
| Unresolved legacy mapping | Dừng Gate hiện tại, giữ flags off | Không | Resolver report unresolved=0 |
| Commerce tạo sai learning_site | Tắt Commerce rồi LMS flag | Không mặc định | Self-target/site/target chính xác |

Cross-site leak or wrong-site mutation is an immediate rollback condition with
no observation delay.

Post-rollback evidence must include flag states, deployment IDs, alias snapshot,
catalog/count checks, error-rate recovery and owner incident reference.
