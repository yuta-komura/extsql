import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

public class LogAppendOnlySample {
    public void test(Connection con) throws SQLException {
        StringBuilder sqlSb = new StringBuilder();
        StringBuilder logSb = new StringBuilder();

        sqlSb.append(" SELECT ");
        sqlSb.append("   ID ");
        sqlSb.append(" FROM ");
        sqlSb.append("   LOG_TABLE ");

        logSb.append(" start ");
        logSb.append(" end ");

        PreparedStatement prepareStatement = con.prepareStatement(sqlSb.toString());
    }
}
