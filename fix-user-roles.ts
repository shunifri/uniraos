import mysql from 'mysql2/promise';

async function fixUserRoles() {
  try {
    console.log('=== 连接到 MySQL 数据库 ===');

    const connection = await mysql.createConnection({
      host: process.env.MYSQL_PRIMARY_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PRIMARY_PORT || '3307'),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '123456',
      database: process.env.MYSQL_DATABASE || 'raos',
    });

    console.log('✅ 连接成功');

    // 查询没有角色的用户
    const [usersWithoutRoles] = await connection.execute(`
      SELECT u.id, u.username
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      WHERE ur.user_id IS NULL
    `);

    console.log('\n=== 没有角色的用户 ===');
    console.log(usersWithoutRoles);

    // 为每个没有角色的用户添加默认角色（role_user）
    console.log('\n=== 添加默认角色 ===');
    const now = Date.now();

    for (const user of usersWithoutRoles as any[]) {
      try {
        await connection.execute(
          'INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)',
          [user.id, 'role_user', now]
        );
        console.log(`✅ 为用户 ${user.username} (${user.id}) 添加了 role_user`);
      } catch (err) {
        console.log(`⚠️ 为用户 ${user.username} (${user.id}) 添加角色失败:`, err);
      }
    }

    // 验证修复结果
    console.log('\n=== 验证修复结果 ===');
    const [userRoles] = await connection.execute(`
      SELECT u.id, u.username, COUNT(ur.role_id) as role_count, GROUP_CONCAT(r.name) as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      GROUP BY u.id, u.username
      ORDER BY u.username
    `);
    console.log(userRoles);

    await connection.end();
    console.log('\n✅ 修复完成！');

  } catch (err) {
    console.error('❌ 修复失败:', err);
    process.exit(1);
  }
}

fixUserRoles();
