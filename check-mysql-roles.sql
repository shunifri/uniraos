USE raos;
-- 检查用户表
SELECT id, username, display_name FROM users LIMIT 5;
-- 检查用户角色关系表
SELECT ur.user_id, ur.role_id, r.name, r.description 
FROM user_roles ur 
LEFT JOIN roles r ON ur.role_id = r.id 
LIMIT 10;
-- 检查是否所有用户都有角色
SELECT u.id, u.username, COUNT(ur.role_id) as role_count 
FROM users u 
LEFT JOIN user_roles ur ON u.id = ur.user_id 
GROUP BY u.id, u.username 
ORDER BY role_count;
