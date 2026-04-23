import mysql from 'mysql2/promise';

async function checkMySQLData() {
  try {
    console.log('=== 尝试连接到 MySQL 数据库 ===');

    // 使用服务器相同的配置
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_PRIMARY_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PRIMARY_PORT || '3307'),
      user: process.env.MYSQL_USER || 'root',  // 使用 root 账号避免权限问题
      password: process.env.MYSQL_PASSWORD || '123456',
      database: process.env.MYSQL_DATABASE || 'raos',
    });

    console.log('✅ 连接成功');

    // 查询用户表
    console.log('\n=== 用户表数据 ===');
    const [users] = await connection.execute('SELECT id, username, display_name FROM users');
    console.log('用户数量:', users.length);
    console.log('用户列表:', users);

    // 查询用户角色关系表
    console.log('\n=== 用户角色关系 ===');
    const [userRoles] = await connection.execute(`
      SELECT ur.user_id, ur.role_id, r.name, r.description
      FROM user_roles ur
      LEFT JOIN roles r ON ur.role_id = r.id
      ORDER BY ur.user_id
    `);
    console.log('角色关系数量:', userRoles.length);
    console.log('角色关系:', userRoles);

    // 检查是否所有用户都有角色
    console.log('\n=== 检查用户角色完整性 ===');
    const [userRoleCount] = await connection.execute(`
      SELECT u.id, u.username, COUNT(ur.role_id) as role_count
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      GROUP BY u.id, u.username
      ORDER BY role_count
    `);

    const usersWithNoRoles = (userRoleCount as any[]).filter(u => u.role_count === 0);
    if (usersWithNoRoles.length > 0) {
      console.log('⚠️ 以下用户没有角色:');
      console.log(usersWithNoRoles);
    } else {
      console.log('✅ 所有用户都有角色');
    }

    await connection.end();

  } catch (err) {
    console.error('❌ 连接或查询失败:', err);
  }
}

// 直接运行测试
checkMySQLData().catch(err => {
  console.error('❌ 测试脚本执行失败:', err);
  process.exit(1);
});
